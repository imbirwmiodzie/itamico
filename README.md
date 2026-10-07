# Italian Voice Tutor: MCP server

Backend for a hands-free Italian conversation tutor, used on a bicycle commute and in the car. The voice front end (the Claude app now, a realtime speech API later) holds the conversation. This server holds all state and logic:

- **Gap capture**: words and corrections the user could not produce, with the sentence they came up in.
- **SM-2 scheduling**: the model grades each answer 0–5 and the server schedules the next review.
- **Session timer**: the server owns the clock and returns `minutes_left` with every response.

It is a remote MCP server over Streamable HTTP, written in TypeScript, backed by Postgres (Supabase or Neon free tier). It serves a single user, guarded by one secret token.

```
 voice front end ──MCP (HTTPS)──▶ this server ──▶ Postgres
 (Claude app / Realtime API)        tools, SM-2, timer
```

## Tools

| Tool | Input | Returns |
|---|---|---|
| `start_session` | `limit_min?` | `session_id`, `due_count`, `due_word_mode`, `minutes_left`, `conversation_words`, `case` (the open mystery, or null) |
| `capture_item` | `italian`, `english`, `note?`, `context?`, `source` | the item and `captured` or `recaptured` |
| `get_due_items` | `mode`, `limit?` (10) | due items by `due_on`, then lowest ease |
| `record_attempt` | `item_id`, `session_id?`, `mode`, `prompt?`, `answer`, `grade`, `fillers` | applied `grade`, `interval_days`, `due_on` |
| `end_session` | `session_id` | items captured and reviewed, plus totals |
| `list_items` | `filter?` (`due` / `recent` / `all`), `limit?` | items, for review on a screen |
| `get_case` | none | the open [Il Caso](#il-caso-a-mystery-told-on-your-rides) mystery with clue progress and events, or candidate clues for a new one |
| `open_case` | `title`, `premise`, `solution`, `clue_ids` (3–6) | the new case |
| `save_episode` | `case_id`, `headline`, `story_so_far`, `outcome?` (`solved` / `dropped`) | episode number and clue progress |
| `get_grammar` | `topic?`, `limit?` (10) | a [grammar lesson](#grammar-by-voice): its rules and exercises on your words; with no topic, the topics and how many of your words each can use |

While a timed session is open, every response also carries `session_id` and `minutes_left`. When the limit passes, the response adds `time_up: true` and a one-line instruction to finish the current item and call `end_session`.

`source` is one of `asked`, `fallback`, `error` or `topic_check`. `mode` is `word` or `sentence`.

### Grading

The model assigns the quality from the transcript. The server applies SM-2:

| Answer | q |
|---|---|
| Correct, fluent, no fillers | 5 |
| Correct, 1–2 fillers or a self-correction | 4 |
| Correct, 3+ fillers | 3 |
| Correct only after a hint | 2 |
| Wrong word or form | 1 |
| English fallback or no answer | 0 |

- **Pass (q ≥ 3):** the interval goes 1 day, then 6, then the previous interval × ease.
- **Fail (q < 3):** repetitions reset and the interval drops to 1 day.
- **Ease:** updated by the standard SM-2 formula on every answer and floored at 1.3. The new interval uses the updated ease, so a low pass grows more slowly.

## Drill page

`https://<host>/drill/<MCP_TOKEN>` is a review on the screen in the style of SuperMemo 98, for when you can look at a phone or a desktop instead of talking. It's linked from the other two pages.

- **One word at a time:** the English prompt is shown; recall the Italian, then **Show answer** (Space or Enter). The answer appears with its note and context sentence, with the word marked in the sentence.
- **Grade yourself 0–5**, with SuperMemo's labels: Null (blackout), Bad, Fail, Pass, Good, Bright (instant). Keys `0`–`5` work too. Each button shows the interval that grade would give.
- **Same scheduling:** grades go through the same SM-2 step as the voice drill and are saved as they're given. They're stored with mode `screen`. They don't join an open voice session, and they're left out of the filler averages on the stats page.
- **Final drill:** words graded below Good (4) come back after the main review, again and again until you grade them Good or Bright. As in SuperMemo, these repeats don't change the schedule and aren't stored.
- **Type answers** (optional switch, remembered in the browser): type the Italian before showing the answer. The page tells you whether it matched, ignoring case and punctuation, and flags accent-only differences. It also suggests a grade.
- **Summary:** pass rate, average grade, how the grades were spread, final drill repeats and time taken. With nothing due, it shows when the next words come.

The design is a card with an Italian tricolour edge, in light and dark mode, and it works on phones. It's guarded by the same token and sent with the same private headers as the other pages. The page needs JavaScript; the other pages don't.

## Il Caso: a mystery told on your rides

Say **“il caso”** to the tutor and it tells you a noir mystery in episodes, one per ride. You are the detective. The clues are your weakest words, and the plot moves with your memory:

- **Episodes:** each one replaces the plain drill. The story stops at gaps only today's due words can fill: *"Il portiere dice che qualcuno ha forzato il… the tailgate?"* Those answers are graded and scheduled like any drill answer. In between, you decide what the detective does next, in a full Italian sentence, and your choices change the story.
- **Clues follow SM-2:** a clue counts as **secured** once its review interval reaches 21 days. Forget one and it goes **freddo** (cold): the next episode opens with a setback, such as a witness taking back a statement. When one gets secured, it's a breakthrough.
- **The finale** unlocks only when every clue is secured. Then you name the culprit and explain why, in Italian, using the clue words. A case lasts a few weeks, about as long as it takes the words to stick.
- **Continuity:** the solution is fixed when the case opens and stays sealed. After each episode the tutor saves a headline and the story so far, so the next ride picks up the plot.

The tutor drives it with three tools: `get_case` (the open case, what changed since the last episode, or candidate clues for a new case), `open_case`, and `save_episode`. `start_session` mentions an open case, so the tutor can offer the next episode.

`https://<host>/case/<MCP_TOKEN>` is the **case board**: a corkboard of the clues, pinned with red string to the unknown culprit. Each clue card shows its photo if it has one, its progress towards secured, and whether it's due today. Below the board are the premise, the story so far, the episode log, and an archive of closed cases with their solutions revealed. The Progress page shows a summary card.

## Game page

`https://<host>/game/<MCP_TOKEN>` is **Lampo** ("lightning"), a 60-second game with your own words, for when you're off the bike and have a minute.

- **Rounds:** each shows a prompt and four answers; tap the right one, or press 1–4. The rounds mix English → Italian, Italian → English, a word's photo → Italian, and **trappola** (trap): the word hidden among look-alikes built from typical learner mistakes:
  - the wrong article (*lo pellicola*)
  - an ending that no longer agrees with the article (*la pellicolo*)
  - one consonant too many or too few (*la pelicola*, *la pellicolla*)
  - a lost or wrong accent (*perche*, *perchè*)
  - c/ch and g/gh mixed up (*il giaccio*)

  A look-alike that is one of your other words is never used, and a bare adjective keeps its ending, since *stanca* would be just as right as *stanco*.
- **Scoring:** 10 points per answer, doubled after 3 in a row, tripled after 6, quadrupled after 10. A miss costs 3 seconds and the streak.
- **Which words:** all of them, but hard ones come up more often: low ease, past failures, and anything due today.
- **Scores:** each round is saved, so the best score follows you across devices.
- **Missed words:** the end screen lists them with what you picked. **Drill these today** makes them due today without restarting their learning, so the next drill, by voice or on screen, asks them.

Picking from four is recognition, much easier than recalling a word, so the game never changes when words are due on its own.

## Grammar page

`https://<host>/grammar/<MCP_TOKEN>` has 28 grammar lessons made from the words in your list. Each lesson explains its rules with your own nouns, adjectives and verbs, lists every word of yours it fits with its forms, and ends with a 10-question practice round on those words. The same lessons can be practised by voice: ask the tutor (see [Grammar by voice](#grammar-by-voice)).

| Group | Lessons |
|---|---|
| Nomi e articoli | the definite article (*lo schermo*), the indefinite article (*uno schermo*), plurals with their article (*gli schermi*), *questo* and *quello* (*quello schermo*, *quegli schermi*), possessives (*il mio schermo*, *mia madre*) |
| Aggettivi | agreement (*Giulia è stanca*, *Marco e Luca sono stanchi*), comparatives and superlatives (*più stanca di*, *la più stanca*, *stanchissima*, *migliore*) |
| Preposizioni e pronomi | *di/a/da/in/su* + article (*nello schermo*), object pronouns (*lo cerco*, *l'ho cercato*, *glielo porto*), *ci* and *ne* (*ci penso*, *ne ho tre*), relative pronouns (*che*, *di cui*, *del quale*), *piacere* (*mi piacciono le chiavi*, *mi è piaciuta*) |
| Presente e passato | the present, the passato prossimo, the imperfetto, passato prossimo or imperfetto (*Ieri…* / *Di solito…*), the passato remoto, the compound tenses (trapassato, futuro anteriore, condizionale passato, congiuntivo passato and trapassato) |
| Futuro, modi e forme | the future, the conditional, the imperative (*cerca!*, *non cercare!*, *si alzi!*), the gerund with *stare* (*sto cercando*), the present subjunctive and when to use it (*penso che cerchi* / *so che cerca*), the imperfect subjunctive, if-sentences of all three kinds |
| La frase | verbs + preposition before an infinitive (*smetto di*, *comincio a*, *voglio —*), the passive and *si* (*è cercato*, *viene cercato*, *si cerca*, *ci si alza*), negation (*non … mai/più/ancora*, *nessuno schermo*) |

- **Which words count:**
  - A noun counts when it's saved with its definite article (*lo schermo*, *l'amica*, *il telefono cellulare*). Whatever follows the noun is carried along where the noun stays singular. Nouns with an extra word are left out of plurals, because that word would have to agree.
  - A verb counts when it's saved as an infinitive and its English starts with "to" (or its note says verb). Phrases work (*fare la spesa* → *faccio la spesa*, *ho fatto la spesa*), and reflexives get their pronouns (*alzarsi* → *mi alzo*, *alzati!*, *mi sto alzando*).
  - An adjective counts when it's saved on its own (*stanco*, *felice*) with an English adjective, or a note that says adjective.
- **Your words in fixed frames:** sentence lessons put your words into fixed frames. The subjunctive uses *Penso che (lui) ___ (cercare)* against *So che…*, if-sentences use *Se (io) ___ (cercare), sarebbe meglio*, the pronoun lesson uses *Porto lo schermo a Giulia* → *Glielo porto*, and so on.
- **Rules with your words:** each rule lists the words of yours that follow it, such as *la targa → le targhe* under -ca → -che. A rule none of your words follows shows a stock example instead.
- **No guessing:** a word joins a lesson only when its forms are certain. `src/italian.ts` has rules for the regular forms and tables for:
  - irregular verbs in every tense, and irregular plurals
  - *-isc-* verbs, and verbs that take *essere*
  - *-co*/*-go* nouns
  - common English adjectives, used to recognise adjectives

  Whatever falls outside those tables is left out of the lessons where it matters, rather than guessed. For example: an *-ire* verb not known to take *-isc-* or not, an *-ere* participle or passato remoto that isn't in the tables, a verb that takes either auxiliary, the gender of *l'ospedale*. An article that breaks the rules (*il pneumatico*) is left out too, so an exception is never taught as a rule.
- **Two right answers:** where Italian allows two forms, both count: *va'* or *vai*, *credei* or *credetti*, *sono andato* or *sono andata* for io, *mi sto alzando* or *sto alzandomi*.
- **Answers:** a typed answer with only an accent wrong counts, with a note (the accent buttons help on a desktop keyboard). A subject pronoun in front (*noi cerchiamo*) is fine. After each answer the page shows the whole sentence and the rule that applies. The end screen lists the misses, and the best score per lesson is remembered in the browser.
- **The schedule is untouched:** knowing a word's plural isn't recalling the word, so practice here never changes when words are due.

### Grammar by voice

Ask the tutor to practise a topic (*"facciamo il congiuntivo"*, *"let's do plurals"*, *"ripassiamo i pronomi"*). It calls `get_grammar` with that topic, explains the rule in a sentence or two, and drills 10 exercises made from your words, one at a time. If it isn't clear which topic you mean, it gets the list and suggests one with many of your words. After each answer it says the right form or the whole sentence, and the rule if you got it wrong. Like the page, it never grades these answers or changes the schedule. When none of your words fit a topic yet, it explains the rule with examples of its own.

## Palazzo: a 3D memory palace

`https://<host>/palazzo/<MCP_TOKEN>` is a building you walk through, first person, with your words in it. It works in a desktop browser and on a phone.

- **The library:** every word is a book. The spines carry the Italian, reading from the bottom up as on Italian books. The books are shelved in alphabetical order of the noun, ignoring articles and accents (*la pellicola* stands under P), and each bookcase has a brass plate with its letters (*D – M*). So a word always stands in the same part of the room, the old memory-palace trick.
- **Spine colours:** vellum for words not yet recalled, red for learning (under a week), green for young (1–3 weeks) and blue with extra gilt for mature (3+ weeks), as on the stats page. A tricolour ribbon marks a word due today. The other books on the shelves are plain and carry no words.
- **The gallery:** behind the library, the hardest words that have a [photo](#photos) hang in gilt frames on red walls, up to 24, with the Italian on a plaque.
- **Passeggiata** (walk): look at a book and its Italian appears; the meaning follows a moment later, so you can recall it first. Click or tap the book to open it: meaning, note, context sentence and stage, plus **Drill it today**.
- **Caccia** (hunt): the page names 10 meanings in English, one at a time, weighted toward hard words as in Lampo. Find each one's book (or its painting) and click it. Since the shelves are alphabetical, the quick way is to recall the Italian and head for its letter. A wrong book costs 5 seconds and shows what that book means. **Aiuto** (help) costs 10 seconds: a column of light marks the book and the map shows where it is. **Salta** (skip) costs 15 seconds and tells you the word. The end screen shows your time, your best time on this device, and the words you needed help with; **Drill these today** puts them in today's drill. Like Lampo, the hunt never changes the schedule on its own.
- **Controls:** W A S D or the arrow keys to walk, Shift to run, the mouse to look (click once to capture it; Esc releases it and opens the menu). On a phone, the left thumb walks with a joystick and the right thumb looks; tap a book to open it. M toggles the map.
- **Size:** up to 300 words go on the shelves. With more, the ones due and hardest are kept. The library grows a pair of bookcases per 96 words.

It is drawn with plain WebGL, with no library and nothing loaded from elsewhere. The lighting is baked into the geometry, the spines and plaques are drawn into canvas textures in the browser, and there's distance fog. Photos come from `/pic/<MCP_TOKEN>/<id>` like everywhere else. It's guarded by the same token and sent with the same private headers as the other pages.
## Word atlas

`https://<host>/atlas/<MCP_TOKEN>` draws the whole dictionary, every word you've captured, in four views (**Atlas** in the nav). The poster and the stats page show only the hardest words or your practice; this page shows the words themselves. It works on phones and desktops in light and dark mode. Hover or tap any word for its English, its next review and how often you've forgotten it.

All four views use the same growth stages, set by a word's review interval: **seme** (seed: not recalled yet, or just forgotten), **germoglio** (sprout: 1 day), **piantina** (seedling: 2–6 days), **bocciolo** (bud: 1–3 weeks), **fiore** (flower: 3 weeks to 3 months) and **ulivo** (olive tree: 3 months or more).

- **Cielo (sky):** every word is a star on a night-sky map. The distance from the sun is the review interval on a log scale, with orbits marked at 1 day, 1 week, 1 month and 3 months. New and just-forgotten words burn close to the sun; words you keep for months drift outward. A star's colour is its stage, its size is how often it's been answered, and it twinkles when it's due. Words that share a note (*feminine*, *verb -are*…) are grouped into named constellations joined by lines. Under the map, **Closest to the sun** lists the eight words nearest the sun. On a phone the star names are hidden because they'd be too small to read; tap a star instead.
- **Giardino (garden):** every word is a plant drawn for its stage, from a seed in the soil to an olive tree, in beds from trees down to seeds. Each flower keeps its own colour. A plant 3 or more days overdue droops, turns brown and says *needs water*, with a link to the drill.
- **Nuvola (cloud):** all the words at once. Size shows how often a word is forgotten (lapses, plus lost ease), or how often it's been answered, and colour shows its stage, warm for new and cool for well kept. **Show in English** switches the whole cloud to the meanings.
- **Errori (mistakes):** what you actually said, set against the right word, letter by letter: the letters you said instead are struck out in red, and the ones you left out are in green (*~~la~~**il** problema*). Each wrong answer gets a label: *accento* (accent or capital only), *articolo* (the article), *desinenza* (the ending), *lettere* (a letter or two) or *altra parola* (a different word). A bar at the top shows which kind of slip you make most. Whole-sentence answers are quoted rather than diffed. Answers that match the word (graded low only for hesitation or a hint) aren't counted.

### Screensaver

`https://<host>/ambient/<MCP_TOKEN>` (**Screensaver** on the atlas page) is a full-screen slideshow for an idle screen, an old tablet or a TV. One word at a time fades in, large, over its photo, which drifts slowly. Without a photo, the word gets a soft colour glow. After a pause the English, the note and the context sentence appear, with the word in bold. A clock sits in the corner. It shows the words that haven't stuck yet (interval under three weeks, or due), due ones first, then the most forgotten, in a slightly different order on each visit.

Click or press Space to show the answer, then again for the next word. **F** toggles full screen and **Esc** goes back to the atlas. Where the browser allows it, the page keeps the screen from sleeping. Options in the URL: `every` (seconds per word, default 20), `reveal` (seconds before the answer, default a third of `every`), `n` (how many words, default 30) and `side=english` to show the English first as a recall test, e.g. `/ambient/<MCP_TOKEN>?every=30&side=english`.

## Poster page

`https://<host>/poster/<MCP_TOKEN>` turns the words you forget most into something to print and put up at home. It's linked from the nav and from **Hardest words** on the stats page.

- **Which words:** any word you've failed at least once, or whose ease has dropped. Each word's score adds up:
  - 1 per lapse (an answer graded below 3);
  - up to 2 more per lapse, the more recent it is (half-life of 30 days);
  - 2 per point of ease lost.

  So a word you keep forgetting lately ranks above one you used to forget.
- **Poster:** one sheet titled *Le parole che scappano* ("the words that get away"). The top word is shown huge, the next three large, and the rest in a grid. Each word has its English, note and context sentence, with the word underlined in the sentence. Up to 12 words get three roomy columns; from 20 the small cards get one line of context.
- **Picture wall:** twelve photo tiles to a sheet, each with the Italian on a band below the photo, the English and the answer history. Words without a photo get a large initial letter instead.
- **Cut-out cards:** eight cards to a sheet with dashed cut lines, to stick on the fridge, the mirror or the front door. A word's photo runs along the top of its card.
- **Photos:** the top word on the poster shows its photo too. **Find photos** fills in every word on the sheet that has none with the first match for its English meaning; open a word on the Words page to choose a better one. Photo credits are printed at the foot of each sheet, and in black-and-white mode the photos print in greyscale.
- **Answer history on every word:** a row of squares, oldest first. A filled square is a lapse and a hollow one is a remembered answer. The difference is fill, not just colour, so it reads for colour-blind eyes and on a black-and-white printer too.
- **Options:** 8 to 24 words; A4, A3 or US Letter (text scales with the paper); colour or black and white. Print it from the page, or save it as PDF from the print dialog. Each sheet fits exactly one page.

## Photos

Photos come from the internet and are stored in the database with the word (one per word), so a poster prints the same even if the photo is later removed from the site it came from.

- **Pexels** (recommended): set `PEXELS_API_KEY` to a free key from [pexels.com/api](https://www.pexels.com/api/). Good everyday photos; the Pexels License allows free use, and the photographer is credited on the poster anyway.
- **Wikimedia Commons**, used when there's no key: free, no sign-up, freely licensed images, but more museum pieces and diagrams than everyday photos. Most need a credit (CC BY, CC BY-SA), which the poster prints.

The search uses the first English meaning without its article ("the commute, journey" → *commute*). For abstract words (*nonostante*, *a malapena*), photos of the meaning rarely work; search instead for something from the context sentence that will remind you of it (for *a malapena*, "foggy road").

The server downloads only from the two image hosts (`images.pexels.com`, `upload.wikimedia.org`), only images, up to 5 MB each. Photos are served at `/pic/<MCP_TOKEN>/<id>`, behind the same token as the pages.

## Stats page

`https://<host>/stats/<MCP_TOKEN>` is a progress page for a browser, built for phones and desktops in light and dark mode. It shows:

- **Headline numbers:** due today, practice streak, pass rate and fillers per answer over the last 7 days, and how many words are learned.
- **Practice calendar:** a heatmap of answers per day over the last 26 weeks (15 on a phone).
- **Answers per day** for the last 30 days, split into passed and failed.
- **Hesitation trend:** average filler sounds per answer per day.
- **How answers were graded:** answers per grade 0–5 over the last 30 days.
- **How well words stick:** pass rate by days since the same word was last answered, a rough forgetting curve. Buckets with fewer than 5 answers are faded.
- **When you practise:** a weekday × hour heatmap of the last 90 days, in `TUTOR_TZ`, with the busiest hour named.
- **Where your words are:** how many are not yet recalled, learning, young or mature.
- **Vocabulary growth:** words in the list at the end of each day, last 90 days.
- **Coming up:** reviews due per day for the next two weeks.
- **Hardest words** and **recently captured words**, with their context.

It uses the same token as the connector URL. A wrong token returns 404. The page is sent with `no-store`, `no-referrer` and `noindex`, so the URL isn't cached, passed on to other sites, or picked up by search engines.

## Words page

`https://<host>/items/<MCP_TOKEN>` lets you search and edit the vocabulary. It's linked from the stats page, and the stats page is linked back from it.

- **Search:** full-text search over Italian, English, note and context.
  - Every word you type must match, and each counts as a prefix (`pell` finds *la pellicola*).
  - Accents are ignored (`perche` finds *perché*).
  - Parts of words also match (`ellicol`).
  - It uses a Postgres GIN index on a `'simple'` text configuration, with no extensions needed.
- **Filters:** all words, due today, missing context, or ever failed.
- **Editing:** tap a word to change its Italian, English, note, context or source; its learning progress is kept. **Make due today** restarts its learning. **Delete** removes it together with its answer history.
- **Answer history:** each word shows its last 10 answers (time, prompt, answer, grade, fillers).
- **Photo:** search the internet for a photo of the word and tap one to keep it (see [Photos](#photos)). It then shows on the poster, the cards and in the drill.
- **Add a word:** adds a word by hand. An existing word isn't duplicated; it becomes due today again.

Like the stats page, it's guarded by the token and sent with `no-store`, `no-referrer` and `noindex`.

## Desktop widget

`https://<host>/widget/<MCP_TOKEN>` is a small card that shows the hardest words one at a time, so you see them during the day between rides. Each word shows first and its answer appears after a pause, with the context sentence and what you said the last time you got it wrong. The card fetches fresh words from `/widget/<MCP_TOKEN>/data` every 10 minutes.

On macOS, `desktop/macos/itamico.lua` pins the card at a fixed spot on screen with [Hammerspoon](https://www.hammerspoon.org): in a corner or at exact coordinates, above all windows or on the desktop. Setup and options are in [`desktop/macos/README.md`](desktop/macos/README.md).

## Decisions beyond the brief

These are things the requirements left open, or places where a small change made the voice loop more robust.

- **Case-insensitive uniqueness.** `items.italian` is unique on `lower(italian)`, so "Lo schermo" and "lo schermo" are one item. Captured text is tidied first: whitespace is collapsed, and wrapping quotes and trailing punctuation are dropped. Apostrophes are kept, so `un po'` survives.
- **Re-capture.** Capturing an existing item updates its gloss and note, and resets it to due today with repetitions cleared. Its ease is kept. The **original context sentence is kept**, because the first context is the memorable one.
- **`items.last_captured_at`.** This column was added to the schema. It is set on every capture or re-capture, and it is how `end_session` knows what was captured during the session.
- **Due items carry no context.** `get_due_items` returns the prompt (`english`), the answer (`italian`) and the grammar note under `after_answer`, but never the context sentence. The context usually contains the answer, and the tutor kept weaving it into the question. It stays on the stats and Words pages.
- **Word mode filters by length.** `get_due_items` in word mode returns only items of 4 words or fewer: something you can say in one breath while riding. Longer corrections wait for sentence mode, and `held_for_sentence_mode` tells the tutor how many are waiting.
- **The server guards the hesitation rows.**
  - `record_attempt` counts filler tokens (eh, ehm, uh, um, mmm, hmm) in `answer` and uses whichever is larger: its own count or the model's.
  - It caps a passing grade at 4 for 1–2 fillers and at 3 for 3 or more.
  - The response reports `grade_capped_from` when this happens.
  - Italian *e* and *ah* are words, so they are never counted.
- **`session_id` is optional on `record_attempt`.** If it is missing or wrong, the attempt is attached to the open session. One less way for a voice model to fail a call.
- **Abandoned sessions.**
  - Voice sessions are usually just dropped, not ended.
  - `start_session` closes any session still open.
  - The clock ignores sessions older than 12 hours.
  - `minutes_left` is rounded **up**, so it reads 0 only once time has actually run out.
- **Conversation words.** `start_session` returns up to 8 `conversation_words`: words captured or practised in the last 21 days that are not yet mature (interval under 21 days), picked at random from the 30 most recently captured. The tutor builds each free-conversation question so that answering it needs one of them, a different word and a different kind of question each time. The random pick keeps one session's questions from repeating the last one's.
- **Dates use the user's time zone.** "Due today" is computed in `TUTOR_TZ` (default `Europe/Warsaw`), not in the server's or the database's zone.
- **Small responses.** Responses are compact JSON with null fields dropped, because tokens are latency in a voice loop.
- **Errors don't stop the conversation.** Errors come back as MCP tool errors with a short message, never as transport failures, so the conversation carries on.

## Setup

### 1. Database

Create a free Postgres on [Neon](https://neon.tech) or [Supabase](https://supabase.com), in a region near you (e.g. Frankfurt). Copy the connection string.

- **Neon:** use the pooled connection string with `?sslmode=require`.
- **Supabase:** use the session or transaction pooler URL. If TLS verification fails, append `?sslmode=no-verify`.

The schema (`sql/schema.sql`) is applied automatically on every boot; it is idempotent. You can also paste it into the SQL editor, or run `npm run build && DATABASE_URL=... npm run migrate`.

### 2. Deploy the server

You need two secrets:

- `DATABASE_URL`: the connection string from step 1.
- `MCP_TOKEN`: a long random string, e.g. `openssl rand -hex 24`.

Optionally set `TUTOR_TZ`, and `PEXELS_API_KEY` for word photos (see [Photos](#photos)). On your own server, pass it to the installer like the other settings (`sudo PEXELS_API_KEY=... ./deploy/install.sh`, or in `deploy/deploy.env`); on Fly.io, `fly secrets set PEXELS_API_KEY=...`.

**Fly.io** (config included, region `fra`, one machine always on):

```sh
fly launch --copy-config --no-deploy
fly secrets set DATABASE_URL='postgres://…' MCP_TOKEN="$(openssl rand -hex 24)"
fly deploy
```

**Your own Debian/Ubuntu server** (Node, systemd, Caddy with automatic HTTPS, local Postgres unless you pass `DATABASE_URL`):

```sh
git clone -b claude/jolly-keller-yzmyth <repo-url> && cd itamico
sudo DOMAIN=tutor.example.com ./deploy/install.sh   # omit DOMAIN to use <ip>.sslip.io
```

For a public HTTPS port other than 443, add `HTTPS_PORT=28443`. Port 80 must still reach the machine, because Let's Encrypt checks the domain over port 80 when it issues and renews the certificate.

To start without a certificate, add `PLAIN_HTTP=1`. Caddy then serves plain HTTP on `HTTPS_PORT`, and port 80 isn't needed. Use this only for testing: traffic, including the token, is unencrypted, and Claude connectors require `https://`. Re-run with `PLAIN_HTTP=0` to switch to HTTPS.

**Behind Cloudflare** (Cloudflare manages the public certificate, and port 80 isn't needed): add `BEHIND_CLOUDFLARE=1` with `DOMAIN` set to the proxied hostname. Caddy then serves `HTTPS_PORT` with a self-signed certificate. In the Cloudflare dashboard, set three things:

1. **DNS:** an `A` record pointing the hostname at the server, with **Proxied** (orange cloud) on.
2. **SSL/TLS → Overview:** mode **Full**. Not "Flexible", and not "Full (strict)".
3. **Rules → Origin Rules:** the hostname goes to destination port `HTTPS_PORT`. Cloudflare only forwards to a fixed list of ports, and 28443 isn't one of them.

The public URL is then `https://<hostname>` with no port.

It prints the connector URL at the end. Re-run it after `git pull` to update; the token and data are kept.

**Push from your computer over SSH** (no GitHub access needed on the server):

```sh
cp deploy/deploy.env.example deploy/deploy.env   # set SSH_TARGET, DOMAIN, HTTPS_PORT…; git-ignored
./deploy/deploy.sh                                # upload this checkout and run the installer
./deploy/deploy.sh --upload-only                  # just copy the files
./deploy/deploy.sh -i ~/Downloads/server.key ubuntu@203.0.113.7   # key and server on the command line, like ssh
```

`-i KEY` and `-p PORT` work as they do for `ssh`, and override `deploy/deploy.env`. A key file that others can read (typical for one in Downloads) is set to `chmod 600` first, because ssh refuses it otherwise.

**Oracle Cloud:** the installer opens ports 80 and `HTTPS_PORT` in the instance's iptables rules, which by default block everything except SSH. You still have to add ingress rules for both ports to the subnet's **Security List** (or the instance's NSG) in the Oracle console.

The script sends every file git tracks, plus new files that aren't ignored, including uncommitted edits. It never sends `.env` or `deploy.env`. On the server it unpacks into `~/itamico` and swaps the new copy into place, then runs `deploy/install.sh` with `sudo`, passing your settings through. It uses one SSH connection, so a password is asked for at most once. It works from Linux, macOS or WSL.

**Railway / Render / any Docker host:** build the included `Dockerfile` and set the same environment variables. The server listens on `PORT` (default 8080).

Keep the server in the **same region as the database**: each tool call makes a few database round trips. Also avoid scale-to-zero, because a cold start mid-ride is a long silence. Neon's free tier suspends the database after a few idle minutes, and the first query after that takes about half a second.

Check it with `curl https://<host>/health`.

### 3. Phase 1 front end: Claude app

1. **Add the connector.** In claude.ai, go to **Settings → Connectors → Add custom connector** and use the URL
   `https://<host>/mcp/<MCP_TOKEN>`.
   Claude's custom connectors support OAuth or no auth, but not a static header. That's why the token goes in the path; treat the whole URL as the secret.
2. **Create the Project.** Create a Project (e.g. "Italiano") and paste `tutor/project-instructions.md` into its custom instructions. Enable the connector in a chat inside the Project.
3. **Allow the tools.** Set the tools to **always allow**, so no confirmation prompt interrupts a ride.
4. **Start a session.** On the phone, open the Project, start voice mode, and talk.

Check early that the Claude app's voice mode calls connector tools in your setup, and that the latency is acceptable. That is the main risk named in the requirements. If either fails, move to phase 2: only the voice layer changes.

### 4. Phase 2 front end: realtime speech-to-speech

The server is unchanged. Point the realtime session at the same endpoint:

- **OpenAI Realtime** (`gpt-realtime-mini`): add a remote MCP tool to the session.
  - `{"type": "mcp", "server_label": "italian_tutor", "server_url": "https://<host>/mcp", "headers": {"Authorization": "Bearer <MCP_TOKEN>"}, "require_approval": "never"}`
  - The path-token URL also works.
  - Use `tutor/project-instructions.md` as the session instructions.
- **Gemini Live:** the client receives tool calls and forwards them over MCP. Use the SDK's MCP client with the bearer header.

The server also sends a short version of the tutor rules as MCP `instructions` on initialize, for clients that surface them.

## Android drill player (Android Auto)

`android/` is a small Android app that drills your words without Claude. A synthesized voice reads each word: the prompt, a pause for you to answer out loud, then the answer. There is no grading, and nothing is written back to the server.

- **Words:** the server picks them (`GET /api/drill`, below). Due words come first, then the ones due soonest, up to the number you set. Only short items (4 words or fewer, as in word mode) are used, and the pick is shuffled. The last list is kept on the phone, so a drill still starts without signal.
- **Order:** English → pause → Italian (recall, the default), Italian → pause → English, or Italian → pause (listen and repeat).
- **Pause:** 5 seconds by default, counted from the end of the prompt. A further 1.5 s follows the answer before the next word.
- **In the car:** it is a media app, so it appears in Android Auto's media apps.
  - Play/pause: pause or resume. Resuming repeats the current word from its prompt.
  - Next: skip the word.
  - Previous: hear the word again, or go back one if it has only just started.
  - The screen shows the prompt and the position (e.g. 3 / 20), plus the answer once it has been said.
  - A navigation prompt or a call pauses the drill, and it resumes afterwards.
- **On the phone** (bike, headphones): the same controls are in the app and in the media notification. Disconnecting headphones or the car pauses it.
- **Voices:** it uses the phone's text-to-speech engine (Google's, normally). Italian and English voices must be installed: **Settings → Text-to-speech output → Install voice data**. The speech rate is set there too.

### Install

1. **Get the APK.**
   - **From CI:** every push builds it. Open the **ci** workflow run in GitHub Actions and download the `itamico-drill-apk` artifact.
   - **Build it yourself:** run `cd android && ./gradlew assembleDebug` (needs the Android SDK). Or open `android/` in Android Studio and press Run.
2. **Install it on the phone.** Open the APK file, or run `adb install -r app-debug.apk`.
3. **Set it up.** Open **Itamico Drill**, paste the same connector URL as in Claude (`https://<host>/mcp/<MCP_TOKEN>`) and tap **Test connection**.
4. **Make it visible in Android Auto.** Android Auto only lists apps from the Play Store until you allow others. Do this once on the phone:
   1. Open Android Auto's settings and tap **Version** about 10 times to unlock developer mode.
   2. In ⋮ → **Developer settings**, tick **Unknown sources**.
   3. Re-check this setting after an Android Auto update.

The debug key is checked in (`android/app/debug.keystore`, standard `android` passwords) so that CI and local builds install over each other. It is not a secret. Don't use it for anything you publish.

### `GET /api/drill`

`Authorization: Bearer <MCP_TOKEN>`, optional `?limit=` (1–100, default 20). It returns `{"items": [{"id", "italian", "english", "due"}], "due": <how many are due>}`.

## Caveats

- **Fillers depend on the transcript.** Filler detection only sees what speech-to-text writes, and many recognisers drop "eh/ehm". If the transcripts come through clean, hesitation grading will be too generous. That is a property of the voice layer, not of this server. Realtime APIs with raw transcripts are better here.
- **Response latency is not measured.** This was out of scope for v1, as specified.

## Development

```sh
npm install
cp .env.example .env    # fill in, then export the variables
npm run dev             # tsx watch, http://localhost:8080/mcp
npm run typecheck
npm test                # unit tests; the end-to-end suite runs when TEST_DATABASE_URL is set
TEST_DATABASE_URL=postgres://postgres@localhost:5432/tutor_test npm test   # wipes that database
```

The end-to-end suite starts the HTTP app on a random port against a real Postgres and drives it with the official MCP client. It covers auth, a full session (capture → drill → timer → summary), re-capture, word-mode filtering, grade capping, session supersession and error handling. CI (`.github/workflows/ci.yml`) runs it against a Postgres 16 service container.

Layout:

```
src/index.ts     boot: config, migrate, listen
src/app.ts       Express app, auth, stateless Streamable HTTP endpoint
src/tools.ts     MCP tool definitions (descriptions double as tutor guidance)
src/store.ts     sessions/timer, capture, due items, attempts
src/grading.ts   SM-2, filler counting, grade capping
src/drill.ts     the Drill page (/drill/<token>)
src/game.ts      the Lampo game (/game/<token>) and its trap look-alikes
src/grammar.ts   the Grammar page (/grammar/<token>)
src/lessons.ts   the 28 grammar lessons on your words, and get_grammar for the voice tutor
src/italian.ts   Italian word forms: articles, plurals, adjectives, verbs in every tense
src/palazzo.ts   the Palazzo, a 3D library and gallery of the words (/palazzo/<token>)
src/case.ts      Il Caso: case state for the tutor's tools, and the case board (/case/<token>)
src/stats.ts     the stats page (/stats/<token>)
src/items.ts     the Words page (/items/<token>)
src/poster.ts    the printable poster (/poster/<token>)
src/atlas.ts     the word atlas (/atlas/<token>) and the screensaver (/ambient/<token>)
src/pictures.ts  photo search and download (Pexels, Wikimedia Commons)
src/widget.ts    desktop widget page and its data
desktop/macos/   Hammerspoon script that pins the widget on screen
sql/schema.sql   schema
tutor/project-instructions.md   Claude Project custom instructions
android/         drill player app for the phone and Android Auto (Java, no dependencies)
```

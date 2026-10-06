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
| `start_session` | `limit_min?` | `session_id`, `due_count`, `due_word_mode`, `minutes_left` |
| `capture_item` | `italian`, `english`, `note?`, `context?`, `source` | the item and `captured` or `recaptured` |
| `get_due_items` | `mode`, `limit?` (10) | due items by `due_on`, then lowest ease |
| `record_attempt` | `item_id`, `session_id?`, `mode`, `prompt?`, `answer`, `grade`, `fillers` | applied `grade`, `interval_days`, `due_on` |
| `end_session` | `session_id` | items captured and reviewed, plus totals |
| `list_items` | `filter?` (`due` / `recent` / `all`), `limit?` | items, for review on a screen |

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

## Poster page

`https://<host>/poster/<MCP_TOKEN>` turns the words you forget most into something to print and put up at home. It's linked from the nav and from **Hardest words** on the stats page.

- **Which words:** any word you've failed at least once, or whose ease has dropped. Each word's score adds up:
  - 1 per lapse (an answer graded below 3);
  - up to 2 more per lapse, the more recent it is (half-life of 30 days);
  - 2 per point of ease lost.

  So a word you keep forgetting lately ranks above one you used to forget.
- **Poster:** one sheet titled *Le parole che scappano* ("the words that get away"). The top word is shown huge, the next three large, and the rest in a grid. Each word has its English, note and context sentence, with the word underlined in the sentence. Up to 12 words get three roomy columns; from 20 the small cards get one line of context.
- **Cut-out cards:** eight cards to a sheet with dashed cut lines, to stick on the fridge, the mirror or the front door.
- **Answer history on every word:** a row of squares, oldest first. A filled square is a lapse and a hollow one is a remembered answer. The difference is fill, not just colour, so it reads for colour-blind eyes and on a black-and-white printer too.
- **Options:** 8 to 24 words; A4, A3 or US Letter (text scales with the paper); colour or black and white. Print it from the page, or save it as PDF from the print dialog. Each sheet fits exactly one page.

## Stats page

`https://<host>/stats/<MCP_TOKEN>` is a progress page for a browser, built for phones and desktops in light and dark mode. It shows:

- **Headline numbers:** due today, practice streak, pass rate and fillers per answer over the last 7 days, and how many words are learned.
- **Answers per day** for the last 30 days, split into passed and failed.
- **Hesitation trend:** average filler sounds per answer per day.
- **Where your words are:** how many are not yet recalled, learning, young or mature.
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
- **Add a word:** adds a word by hand. An existing word isn't duplicated; it becomes due today again.

Like the stats page, it's guarded by the token and sent with `no-store`, `no-referrer` and `noindex`.

## Decisions beyond the brief

These are things the requirements left open, or places where a small change made the voice loop more robust.

- **Case-insensitive uniqueness.** `items.italian` is unique on `lower(italian)`, so "Lo schermo" and "lo schermo" are one item. Captured text is tidied first: whitespace is collapsed, and wrapping quotes and trailing punctuation are dropped. Apostrophes are kept, so `un po'` survives.
- **Re-capture.** Capturing an existing item updates its gloss and note, and resets it to due today with repetitions cleared. Its ease is kept. The **original context sentence is kept**, because the first context is the memorable one.
- **`items.last_captured_at`.** This column was added to the schema. It is set on every capture or re-capture, and it is how `end_session` knows what was captured during the session.
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

Optionally set `TUTOR_TZ`.

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
src/stats.ts     the stats page (/stats/<token>)
src/items.ts     the Words page (/items/<token>)
src/poster.ts    the printable poster (/poster/<token>)
sql/schema.sql   schema
tutor/project-instructions.md   Claude Project custom instructions
```

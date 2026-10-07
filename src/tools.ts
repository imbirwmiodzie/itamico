// MCP surface: nine tools over Store (six for the drill, three for Il Caso). Every response carries the session clock
// (session_id, minutes_left, time_up) so the tutor can stop on time without a
// clock of its own.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { MAX_CLUES, MIN_CLUES, SECURED_DAYS } from "./case.js";
import { Store, TutorError, WORD_MODE_MAX_WORDS } from "./store.js";

const INSTRUCTIONS = `Italian voice tutor backend. The user is riding a bicycle or driving and only talks.
Call start_session first (together with get_due_items). Voice mode may cut off your reply when the user pauses mid-sentence and then carries on: if their new message continues the previous one or ignores your last reply, assume they didn't hear it, answer both messages as one, and say again anything from the cut-off reply that still matters (a correction, the drill prompt); never move on past an unheard prompt, and don't repeat tool calls that already went through. Speak first, save after: in a turn that calls capture_item or record_attempt, say your reply first and put the tool calls at the end of the turn, then end the turn: no more text and no other tool calls (never placeholder calls such as code execution). Call capture_item silently whenever the user asks what an Italian word means or how to say something, falls back to English or Polish, or needs the correct form supplied. Drill due items (get_due_items) before free conversation and grade each answer with record_attempt. A drill prompt never gives the answer away: no Italian lead-in containing it. Never reuse prompt sentences; invent new ones each time. In free conversation, build every question around one of the conversation_words from start_session, so that answering naturally needs that word (don't say the word yourself); use a different word and a different kind of question each turn, and never ask the same question twice. Answers are speech-to-text transcripts that often garble correct Italian: if it could be the right word misheard, it is right; correct only certain mistakes (wrong word, article, ending, preposition), never spelling or pronunciation, and ask for a repeat at most once. Don't keep asking about the ride, route, distance or arrival time; talk about anything else and don't circle back to covered topics. Il Caso is the user's mystery story, told in episodes across rides: if start_session returns case, offer once to continue it; when the user asks for the case or the story, call get_case together with get_due_items and follow its instruction. An episode replaces the plain drill: today's due items are its gaps. Every response includes minutes_left for a timed session; when time_up is true, finish the current item and call end_session.`;

const GRADE_TABLE = `SM-2 quality: 5 = correct, fluent, no fillers; 4 = correct with 1-2 fillers or a self-correction; 3 = correct with 3+ fillers; 2 = correct only after a hint; 1 = wrong word or form; 0 = English/Polish fallback or no answer.`;

const mode = z.enum(["word", "sentence"]);

export function buildServer(store: Store): McpServer {
  const server = new McpServer({ name: "italian-tutor", version: "1.0.0" }, { instructions: INSTRUCTIONS });

  const run = async (fn: () => Promise<object>): Promise<CallToolResult> => {
    try {
      const result = await fn();
      const clock = await store.clock();
      const body: Record<string, unknown> = { ...result };
      if (clock) {
        body.session_id ??= clock.session_id;
        if (clock.minutes_left !== undefined) body.minutes_left = clock.minutes_left;
        if (clock.time_up) {
          body.time_up = true;
          body.instruction = "Time is up: finish the current item, then call end_session.";
        }
      }
      return { content: [{ type: "text", text: JSON.stringify(body) }] };
    } catch (e) {
      if (!(e instanceof TutorError)) console.error(e);
      const message = e instanceof TutorError ? e.message : "internal error; carry on with the conversation";
      return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: message }) }] };
    }
  };

  server.registerTool(
    "start_session",
    {
      title: "Start session",
      description:
        "Call first, before saying anything substantive. Opens a session (closing any previous one) and starts the server-side timer. Pass limit_min when the user asks for a time limit (e.g. 10). Returns session_id, due_count (all due items), due_word_mode (due items short enough for word mode), minutes_left, case (the open Il Caso mystery, or null; offer once to continue it) and conversation_words: recently learned words (a different random pick each session) to steer free conversation towards. In free conversation, ask questions whose natural answer needs one of these words, without saying the word yourself; a different word and a different kind of question each time.",
      inputSchema: {
        limit_min: z.number().int().min(1).max(240).optional().describe("Session length in minutes; omit for no limit"),
      },
    },
    ({ limit_min }) => run(() => store.startSession(limit_min)),
  );

  server.registerTool(
    "capture_item",
    {
      title: "Capture gap",
      description:
        "Silently store a gap the user could not produce. Call when (1) the user asks what an Italian word means or how to say something in Italian [source 'asked'], (2) the user falls back to English or Polish mid-sentence [source 'fallback'], (3) you had to supply the correct form of a word, grammar or usage [source 'error'; never for what may be a speech-recognition mishearing], or (4) the user failed to produce a word taught during topic vocabulary [source 'topic_check']. Store the correct Italian form only (a word, short phrase or corrected form like 'mi piacciono' or 'su una pista ciclabile'), never the user's mistake. An existing item is not duplicated; re-capturing it makes it due again today. Do not announce the capture beyond a word or two. Speed: say your reply first and call this at the end of your turn.",
      inputSchema: {
        italian: z.string().min(1).max(200).describe("Correct Italian word, phrase or corrected form"),
        english: z.string().min(1).max(200).describe("Short English gloss"),
        note: z.string().max(200).optional().describe("Grammar hint, e.g. 'masculine: lo schermo', 'plural agreement'"),
        context: z.string().max(500).optional().describe("The sentence the gap came up in, as the user said it"),
        source: z.enum(["asked", "fallback", "error", "topic_check"]),
      },
    },
    (args) => run(() => store.captureItem(args)),
  );

  server.registerTool(
    "get_due_items",
    {
      title: "Get due items",
      description: `Items due for review, oldest due date first, then lowest ease. mode 'word' (cycling): only items of ${WORD_MODE_MAX_WORDS} words or fewer; say the English, the user answers in Italian. mode 'sentence' (car/home): all due items; invent a NEW English sentence containing the item every time (never reuse one) and have the user translate it aloud. held_for_sentence_mode counts longer items skipped in word mode. Each item: english = what you say as the prompt; italian = the answer; after_answer = grammar note. NEVER say the answer, a word from its family, or the note before the user has answered, and don't lead in with an Italian sentence that contains it: the simplest prompt is "Come si dice: <english>?". Hints are the first syllable or a related word. After the answer you may use the note in a few words (e.g. when correcting). Items marked new have never been recalled successfully.`,
      inputSchema: {
        mode,
        limit: z.number().int().min(1).max(50).optional().describe("Default 10"),
      },
      annotations: { readOnlyHint: true },
    },
    ({ mode, limit }) => run(() => store.dueItems(mode, limit ?? 10)),
  );

  server.registerTool(
    "record_attempt",
    {
      title: "Record attempt",
      description: `Grade one drill answer; the server applies SM-2 scheduling. Call once per item per drill, with the grade of the FIRST answer: a word right only after a hint is 2 even if the final repeat was clean. ${GRADE_TABLE} answer is a speech-to-text transcript: a correct word the transcript garbled (it could sound like the answer) is correct, so grade it as such. fillers = number of filler sounds (eh, ehm, uh...) in the answer; the server caps the grade at 4 for 1-2 fillers and 3 for 3+. Returns the new interval_days and due_on. Speed: say your reaction and the next prompt first, then call this at the end of your turn; don't wait for the result to speak.`,
      inputSchema: {
        item_id: z.number().int(),
        session_id: z.number().int().optional().describe("From start_session; defaults to the open session"),
        mode,
        prompt: z.string().max(500).optional().describe("The English word or sentence you gave"),
        answer: z.string().max(1000).describe("The user's transcribed answer, fillers included"),
        grade: z.number().int().min(0).max(5),
        fillers: z.number().int().min(0).max(50).default(0),
      },
    },
    (args) => run(() => store.recordAttempt(args)),
  );

  server.registerTool(
    "end_session",
    {
      title: "End session",
      description:
        "Close the session when time is up or the user is done. Returns what was captured and reviewed this session; summarise it in one spoken line.",
      inputSchema: { session_id: z.number().int() },
    },
    ({ session_id }) => run(() => store.endSession(session_id)),
  );

  server.registerTool(
    "get_case",
    {
      title: "Get case",
      description: `Il Caso: the user's ongoing noir mystery, one episode per ride, whose clues are their weakest words. Call when the user asks for the case or the story ("il caso", "la storia", "il giallo", "episodio"), or accepts your offer to continue it, together with get_due_items. Returns the open case: title, episode number, premise, the secret solution (never reveal it before the finale), story_so_far, clues with progress (stages 0-4; secured at 4, after ${SECURED_DAYS}+ days remembered) and due_today, events since the last episode (a clue that went cold = a setback in the plot; secured = a breakthrough), solvable, and an instruction. With no case open, returns candidate_clues to build one with open_case.`,
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => run(() => store.getCase()),
  );

  server.registerTool(
    "open_case",
    {
      title: "Open case",
      description: `Start a new case when get_case returned none. Invent it around ${MIN_CLUES}-${MAX_CLUES} of the candidate_clues, each of which must matter to the solution: an Italian title, a premise (2-3 sentences, simple Italian), and a secret solution (who did it, how, and how each clue proves it). The solution is fixed now so the story stays consistent. Returns the case as get_case does; then tell episode 1.`,
      inputSchema: {
        title: z.string().min(1).max(120).describe('Italian title, e.g. "La Vespa rubata"'),
        premise: z.string().min(1).max(1000).describe("What the detective (the user) is called in to solve, 2-3 sentences"),
        solution: z.string().min(1).max(1500).describe("Who did it, how, and how each clue word proves it"),
        clue_ids: z.array(z.number().int()).min(MIN_CLUES).max(MAX_CLUES).describe("item_ids from candidate_clues"),
      },
    },
    (args) => run(() => store.openCase(args)),
  );

  server.registerTool(
    "save_episode",
    {
      title: "Save episode",
      description:
        'Call at the very end of an episode (after its cliffhanger), or when the session ends mid-episode. headline: one line on what happened. story_so_far: the whole story rewritten to date, in simple Italian, enough to continue next ride: characters, places, what the user decided, open threads (max 3000 characters). outcome "solved" only in the finale, when get_case said solvable and the user has named the culprit; "dropped" when the user wants to give up on this case (reveal the solution first). Speed: speak first, call this last.',
      inputSchema: {
        case_id: z.number().int(),
        headline: z.string().min(1).max(200),
        story_so_far: z.string().min(1).max(3000),
        outcome: z.enum(["solved", "dropped"]).optional(),
      },
    },
    (args) => run(() => store.saveEpisode(args)),
  );

  server.registerTool(
    "list_items",
    {
      title: "List items",
      description:
        "List stored items for review on screen: 'due' (due today or overdue), 'recent' (captured in the last 14 days), 'all'. Not needed during a spoken drill.",
      inputSchema: {
        filter: z.enum(["due", "recent", "all"]).optional().describe("Default 'due'"),
        limit: z.number().int().min(1).max(500).optional().describe("Default 50"),
      },
      annotations: { readOnlyHint: true },
    },
    ({ filter, limit }) => run(() => store.listItems(filter ?? "due", limit ?? 50)),
  );

  return server;
}

// MCP surface: six tools over Store. Every response carries the session clock
// (session_id, minutes_left, time_up) so the tutor can stop on time without a
// clock of its own.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { Store, TutorError, WORD_MODE_MAX_WORDS } from "./store.js";

const INSTRUCTIONS = `Italian voice tutor backend. The user is riding a bicycle or driving and only talks.
Call start_session first (together with get_due_items). Speak first, save after: in a turn that calls capture_item or record_attempt, say your reply first and put the tool calls at the end of the turn, then end the turn: no more text and no other tool calls (never placeholder calls such as code execution). Call capture_item silently whenever the user asks what an Italian word means or how to say something, falls back to English or Polish, or needs the correct form supplied. Drill due items (get_due_items) before free conversation and grade each answer with record_attempt. Never reuse prompt sentences; invent new ones each time. Every response includes minutes_left for a timed session; when time_up is true, finish the current item and call end_session.`;

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
        "Call first, before saying anything substantive. Opens a session (closing any previous one) and starts the server-side timer. Pass limit_min when the user asks for a time limit (e.g. 10). Returns session_id, due_count (all due items), due_word_mode (due items short enough for word mode) and minutes_left.",
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
        "Silently store a gap the user could not produce. Call when (1) the user asks what an Italian word means or how to say something in Italian [source 'asked'], (2) the user falls back to English or Polish mid-sentence [source 'fallback'], (3) you had to supply the correct form of a word, grammar or usage [source 'error'], or (4) the user failed to produce a word taught during topic vocabulary [source 'topic_check']. Store the correct Italian form only (a word, short phrase or corrected form like 'mi piacciono' or 'su una pista ciclabile'), never the user's mistake. An existing item is not duplicated; re-capturing it makes it due again today. Do not announce the capture beyond a word or two. Speed: say your reply first and call this at the end of your turn.",
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
      description: `Items due for review, oldest due date first, then lowest ease. mode 'word' (cycling): only items of ${WORD_MODE_MAX_WORDS} words or fewer; say the English, the user answers in Italian. mode 'sentence' (car/home): all due items; invent a NEW English sentence containing the item every time (never reuse one) and have the user translate it aloud. held_for_sentence_mode counts longer items skipped in word mode. Items marked new have never been recalled successfully; context is where the gap first came up.`,
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
      description: `Grade one drill answer; the server applies SM-2 scheduling. Call once per item per drill, with the grade of the FIRST answer: a word right only after a hint is 2 even if the final repeat was clean. ${GRADE_TABLE} fillers = number of filler sounds (eh, ehm, uh...) in the answer; the server caps the grade at 4 for 1-2 fillers and 3 for 3+. Returns the new interval_days and due_on. Speed: say your reaction and the next prompt first, then call this at the end of your turn; don't wait for the result to speak.`,
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

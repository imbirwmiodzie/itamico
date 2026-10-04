// End-to-end: real Postgres, real HTTP, the official MCP client.
// Needs TEST_DATABASE_URL pointing at a scratch database (it is wiped).

import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../src/app.js";
import { createPool, type Db, migrate, today } from "../src/db.js";
import { Store } from "../src/store.js";

const url = process.env.TEST_DATABASE_URL;
const TOKEN = "test-token-0123456789abcdef";
const TZ = "Europe/Warsaw";

describe("MCP server", { skip: !url && "TEST_DATABASE_URL not set" }, () => {
  let db: Db;
  let http: Server;
  let base: string;
  let client: Client;

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content as { type: string; text: string }[])[0].text;
    return { ...JSON.parse(text), _isError: r.isError === true };
  };

  before(async () => {
    db = createPool(url!);
    await db.query("drop table if exists attempts, items, sessions cascade");
    await migrate(db);
    await migrate(db); // idempotent
    const app = createApp(new Store(db, TZ), TOKEN);
    http = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const port = (http.address() as { port: number }).port;
    base = `http://127.0.0.1:${port}`;
    client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/${TOKEN}`)));
  });

  after(async () => {
    await client?.close();
    http?.close();
    await db?.end();
  });

  test("auth: header and path token accepted, wrong token rejected", async () => {
    const init = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "1" } },
    };
    const post = (path: string, headers: Record<string, string> = {}) =>
      fetch(base + path, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
        body: JSON.stringify(init),
      });
    assert.equal((await post("/mcp")).status, 401);
    assert.equal((await post("/mcp", { authorization: "Bearer nope" })).status, 401);
    assert.equal((await post("/mcp/wrong-token")).status, 404);
    assert.equal((await post("/mcp", { authorization: `Bearer ${TOKEN}` })).status, 200);
    assert.equal((await post(`/mcp/${TOKEN}`)).status, 200);
    assert.equal((await fetch(`${base}/health`)).status, 200);
  });

  test("lists the six tools", async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      "capture_item",
      "end_session",
      "get_due_items",
      "list_items",
      "record_attempt",
      "start_session",
    ]);
  });

  test("a full session: capture, drill, timer, summary", async () => {
    const s = await call("start_session", { limit_min: 10 });
    assert.equal(s.due_count, 0);
    assert.equal(s.minutes_left, 10);
    const sid = s.session_id;

    // Capture signals.
    const a = await call("capture_item", {
      italian: "tragitto",
      english: "commute, journey",
      context: "what does tragitto mean",
      source: "asked",
    });
    assert.equal(a.status, "captured");
    assert.equal(a.item.due_on, today(TZ));
    assert.equal(a.minutes_left, 10);
    await call("capture_item", { italian: "lo schermo", english: "the screen", note: "masculine", source: "error" });
    await call("capture_item", {
      italian: "su una pista ciclabile di città",
      english: "on a city bike lane",
      note: "preposition su",
      source: "error",
    });

    // Re-capture does not duplicate and keeps the original context.
    const again = await call("capture_item", {
      italian: "Tragitto.",
      english: "commute",
      context: "a different sentence",
      source: "fallback",
    });
    assert.equal(again.status, "recaptured");
    assert.equal(again.item.id, a.item.id);
    assert.equal(again.item.context, "what does tragitto mean");

    // Word mode holds back the long phrase.
    const word = await call("get_due_items", { mode: "word" });
    assert.deepEqual(word.items.map((i: { italian: string }) => i.italian).sort(), ["lo schermo", "tragitto"]);
    assert.equal(word.held_for_sentence_mode, 1);
    assert.equal(word.due_total, 3);
    assert.equal(word.items[0].new, true);
    // The context (which contains the answer) is kept apart from the prompt.
    const tragitto = word.items.find((i: { italian: string }) => i.italian === "tragitto");
    assert.equal(tragitto.context, undefined);
    assert.equal(tragitto.after_answer.context, "what does tragitto mean");
    const sentence = await call("get_due_items", { mode: "sentence", limit: 10 });
    assert.equal(sentence.items.length, 3);

    // Fluent pass: due tomorrow.
    const pass = await call("record_attempt", {
      item_id: a.item.id,
      session_id: sid,
      mode: "word",
      prompt: "commute",
      answer: "tragitto",
      grade: 5,
      fillers: 0,
    });
    assert.equal(pass.passed, true);
    assert.equal(pass.interval_days, 1);
    assert.notEqual(pass.due_on, today(TZ));

    // The model under-counted fillers: the server counts them and caps the grade.
    const schermo = word.items.find((i: { italian: string }) => i.italian === "lo schermo");
    const hesitant = await call("record_attempt", {
      item_id: schermo.id,
      session_id: sid,
      mode: "word",
      answer: "eh... ehm, uh, lo schermo",
      grade: 5,
      fillers: 1,
    });
    assert.equal(hesitant.grade, 3);
    assert.equal(hesitant.grade_capped_from, 5);
    assert.equal(hesitant.fillers, 3);

    // A failure in sentence mode: due again tomorrow, ease lowered.
    const long = sentence.items.find((i: { italian: string }) => i.italian.startsWith("su una"));
    const fail = await call("record_attempt", {
      item_id: long.id,
      mode: "sentence",
      prompt: "I ride on a city bike lane every morning",
      answer: "in una pista ciclabile",
      grade: 1,
      fillers: 0,
    });
    assert.equal(fail.passed, false);
    assert.equal(fail.interval_days, 1);
    const { rows } = await db.query("select ease, session_id from items join attempts on attempts.item_id = items.id where items.id = $1", [long.id]);
    assert.ok(rows[0].ease < 2.5);
    assert.equal(Number(rows[0].session_id), sid, "attempt without session_id joins the open session");

    // Nothing left due.
    assert.equal((await call("get_due_items", { mode: "sentence" })).items.length, 0);

    // The clock: 9.5 minutes elapsed rounds up to 1 left; past the limit is time_up.
    await db.query("update sessions set started_at = now() - interval '9 minutes 30 seconds' where id = $1", [sid]);
    assert.equal((await call("list_items", { filter: "recent" })).minutes_left, 1);
    await db.query("update sessions set started_at = now() - interval '11 minutes' where id = $1", [sid]);
    const late = await call("list_items", { filter: "all" });
    assert.equal(late.minutes_left, 0);
    assert.equal(late.time_up, true);
    assert.equal(late.total_items, 3);

    const end = await call("end_session", { session_id: sid });
    assert.deepEqual(end.totals, { captured: 3, reviewed: 3, passed: 2, still_due: 0 });
    assert.equal(end.minutes, 11);
    // After the session closes, no clock is reported.
    assert.equal((await call("list_items")).minutes_left, undefined);
  });

  test("a new session supersedes an abandoned one; untimed has no minutes_left", async () => {
    const one = await call("start_session", { limit_min: 5 });
    const two = await call("start_session", {});
    assert.notEqual(one.session_id, two.session_id);
    assert.equal(two.minutes_left, undefined);
    const { rows } = await db.query("select ended_at from sessions where id = $1", [one.session_id]);
    assert.notEqual(rows[0].ended_at, null);
  });

  test("stats page: token-guarded, renders data, escapes user text", async () => {
    assert.equal((await fetch(`${base}/stats/wrong-token`)).status, 404);
    await call("capture_item", {
      italian: "la pellicola",
      english: "plastic wrap",
      context: "<script>alert(1)</script> how do you say plastic wrap?",
      source: "asked",
    });
    const res = await fetch(`${base}/stats/${TOKEN}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    const html = await res.text();
    assert.match(html, /Italian progress/);
    assert.match(html, /la pellicola/);
    assert.match(html, /Answers per day/);
    assert.ok(!html.includes("<script>alert(1)</script>"), "user text must be escaped");
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });

  test("words page: full-text search", async () => {
    await call("capture_item", { italian: "perché", english: "why, because", context: "non so perché", source: "asked" });
    await call("capture_item", { italian: "il portellone", english: "the tailgate", note: "masculine", context: "ho aperto il tailgate", source: "fallback" });
    const store = new Store(db, TZ);
    const names = async (q: string, filter: "all" | "due" | "nocontext" | "failed" = "all") =>
      (await store.searchItems(q, filter)).items.map((i: { italian: string }) => i.italian);

    assert.deepEqual(await names("perche"), ["perché"], "accents folded");
    assert.deepEqual(await names("pell"), ["la pellicola"], "word prefix");
    assert.deepEqual(await names("tailgate"), ["il portellone"], "english and context");
    assert.deepEqual(await names("masculine aperto"), ["il portellone"], "all words required, across fields");
    assert.deepEqual(await names("ellicol"), ["la pellicola"], "mid-word substring");
    assert.deepEqual(await names("a:b & | ! ( ) ' 100%"), [], "query syntax and LIKE wildcards are inert");
    assert.ok((await names("")).length >= 5, "empty query lists everything");
    assert.ok(!(await names("", "nocontext")).includes("perché"));
    const hit = (await store.searchItems("tragitto")).items[0];
    assert.equal(hit.italian, "tragitto");
    assert.ok(hit.history.length >= 1 && "grade" in hit.history[0], "answer history included");

    const page = await (await fetch(`${base}/items/${TOKEN}?q=perche`)).text();
    assert.match(page, /perché/);
    assert.match(page, /1 match/);
    assert.equal((await fetch(`${base}/items/wrong-token?q=x`)).status, 404);
  });

  test("words page: edit, reset, delete, add", async () => {
    const store = new Store(db, TZ);
    const id = (await store.searchItems("perche")).items[0].id;
    const post = (path: string, body: Record<string, string>) =>
      fetch(`${base}/items/${path}`, { method: "POST", body: new URLSearchParams(body), redirect: "manual" });
    const loc = (r: Response) => new URL(r.headers.get("location") ?? "", base).searchParams;
    const form = { q: "perche", filter: "all", italian: "perché", english: "why", note: "also: because", context: "non so perché", source: "asked" };

    let res = await post(`${TOKEN}/${id}`, { ...form, action: "save" });
    assert.equal(res.status, 303);
    assert.match(res.headers.get("location") ?? "", /msg=Saved.*open=\d+#i\d+/);
    let row = (await db.query("select english, note from items where id = $1", [id])).rows[0];
    assert.deepEqual(row, { english: "why", note: "also: because" });

    res = await post(`${TOKEN}/${id}`, { ...form, italian: "Lo Schermo", action: "save" });
    assert.match(loc(res).get("err") ?? "", /"Lo Schermo" already exists/, "duplicate italian refused");

    await db.query("update items set repetitions = 3, interval_days = 20, due_on = current_date + 20 where id = $1", [id]);
    await post(`${TOKEN}/${id}`, { ...form, action: "reset" });
    row = (await db.query("select repetitions, interval_days, due_on from items where id = $1", [id])).rows[0];
    assert.deepEqual(row, { repetitions: 0, interval_days: 0, due_on: today(TZ) });

    assert.equal((await post(`wrong-token/${id}`, { action: "delete" })).status, 404);
    await post(`${TOKEN}/${id}`, { action: "delete" });
    assert.equal((await db.query("select 1 from items where id = $1", [id])).rowCount, 0);

    res = await post(`${TOKEN}/new`, { italian: "sfasciare", english: "to wreck", source: "asked", context: "", note: "" });
    assert.equal(loc(res).get("msg"), "Added “sfasciare”.");
    res = await post(`${TOKEN}/new`, { italian: "x", english: "y", source: "bogus" });
    assert.match(loc(res).get("err") ?? "", /unknown source/);
  });

  test("errors come back as tool errors, not crashes", async () => {
    const r = await call("record_attempt", { item_id: 999999, mode: "word", answer: "x", grade: 5, fillers: 0 });
    assert.equal(r._isError, true);
    assert.match(r.error, /not found/);
    const bad = await client.callTool({ name: "capture_item", arguments: { italian: "x", english: "y", source: "nope" } });
    assert.equal(bad.isError, true);
  });
});

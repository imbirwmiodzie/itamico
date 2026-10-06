// End-to-end: real Postgres, real HTTP, the official MCP client.
// Needs TEST_DATABASE_URL pointing at a scratch database (it is wiped).

import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../src/app.js";
import { createPool, type Db, migrate, today } from "../src/db.js";
import { Pictures } from "../src/pictures.js";
import { Store } from "../src/store.js";

const url = process.env.TEST_DATABASE_URL;
const TOKEN = "test-token-0123456789abcdef";
const TZ = "Europe/Warsaw";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);

// Stands in for Wikimedia Commons: one photo per search, named after the query,
// except "nothing", which finds nothing.
const fakePhotos = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  if (url.hostname === "upload.wikimedia.org") return new Response(JPEG, { headers: { "content-type": "image/jpeg" } });
  const q = (url.searchParams.get("gsrsearch") ?? "").replace(" filetype:bitmap", "");
  if (q === "nothing") return Response.json({});
  const slug = encodeURIComponent(q.replace(/\s+/g, "_"));
  return Response.json({ query: { pages: [{ title: `File:${q}.jpg`, index: 1, imageinfo: [{ mime: "image/jpeg", thumburl: `https://upload.wikimedia.org/x/960px-${slug}.jpg`, descriptionurl: `https://commons.wikimedia.org/wiki/File:${slug}`, extmetadata: { Artist: { value: "Ugo Foto" }, LicenseShortName: { value: "CC BY 4.0" } } }] }] } });
}) as typeof fetch;

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
    await db.query("drop table if exists pictures, attempts, items, sessions cascade");
    await migrate(db);
    await migrate(db); // idempotent
    const app = createApp(new Store(db, TZ), TOKEN, new Pictures({ fetch: fakePhotos }));
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

  test("lists the nine tools", async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      "capture_item",
      "end_session",
      "get_case",
      "get_due_items",
      "list_items",
      "open_case",
      "record_attempt",
      "save_episode",
      "start_session",
    ]);
  });

  test("a full session: capture, drill, timer, summary", async () => {
    const s = await call("start_session", { limit_min: 10 });
    assert.equal(s.due_count, 0);
    assert.deepEqual(s.conversation_words, []);
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
    // The context (which contains the answer) is never sent with a due item; the note travels apart.
    const tragitto = word.items.find((i: { italian: string }) => i.italian === "tragitto");
    assert.equal(tragitto.context, undefined);
    assert.equal(tragitto.after_answer, undefined);
    const screen = word.items.find((i: { italian: string }) => i.italian === "lo schermo");
    assert.deepEqual(screen.after_answer, { note: "masculine" });
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
    // Recently learned words from the previous test come back for free conversation.
    assert.deepEqual(
      two.conversation_words.map((w: { italian: string }) => w.italian).sort(),
      ["lo schermo", "su una pista ciclabile di città", "tragitto"],
    );
    assert.deepEqual(
      two.conversation_words.find((w: { italian: string }) => w.italian === "tragitto"),
      { italian: "tragitto", english: "commute" },
    );
    assert.equal(two.minutes_left, undefined);
    const { rows } = await db.query("select ended_at from sessions where id = $1", [one.session_id]);
    assert.notEqual(rows[0].ended_at, null);

    // Mature words are left out of conversation.
    await db.query("update items set interval_days = 30 where italian = 'lo schermo'");
    const three = await call("start_session", {});
    assert.deepEqual(
      three.conversation_words.map((w: { italian: string }) => w.italian).sort(),
      ["su una pista ciclabile di città", "tragitto"],
    );
    await db.query("update items set interval_days = 1 where italian = 'lo schermo'");
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
    for (const h of ["Practice calendar", "How answers were graded", "How well words stick", "When you practise", "Vocabulary growth"]) {
      assert.match(html, new RegExp(h));
    }
    assert.ok(!/NaN|undefined|Infinity/.test(html));
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

  test("widget: token-guarded, failed words first, data safe inside the page", async () => {
    assert.equal((await fetch(`${base}/widget/wrong-token`)).status, 404);
    assert.equal((await fetch(`${base}/widget/wrong-token/data`)).status, 404);

    const res = await fetch(`${base}/widget/${TOKEN}/data?n=3`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const data = await res.json();
    assert.equal(data.words.length, 3);
    assert.equal(data.streak, 1);
    assert.equal(data.words[0].italian, "su una pista ciclabile di città", "the failed word leads");
    assert.equal(data.words[0].fails, 1);
    assert.equal(data.words[0].last_wrong, "in una pista ciclabile");

    // Mature words drop out of the rotation unless due.
    await db.query("update items set interval_days = 30, due_on = current_date + 30 where italian = 'tragitto'");
    const all = await (await fetch(`${base}/widget/${TOKEN}/data?n=50`)).json();
    assert.ok(!all.words.some((w: { italian: string }) => w.italian === "tragitto"));

    const page = await fetch(`${base}/widget/${TOKEN}?every=5&n=99`);
    assert.equal(page.headers.get("referrer-policy"), "no-referrer");
    const html = await page.text();
    assert.match(html, /EVERY = 10000/, "every is clamped to 10 s");
    assert.match(html, /data\?n=50/, "n is clamped to 50");
    // la pellicola's context holds a <script> tag; inside the JSON block it must stay inert.
    assert.ok(html.includes("\\u003cscript>alert(1)\\u003c/script>"));
    assert.ok(!html.includes("<script>alert(1)"));
  });

  test("drill page: due items, grading on the screen, no voice session", async () => {
    assert.equal((await fetch(`${base}/drill/wrong-token`)).status, 404);
    const store = new Store(db, TZ);
    const { item } = await store.captureItem({ italian: "la ciotola", english: "the bowl", context: "</script><b>x</b> la ciotola", source: "asked" });
    const open = await call("start_session", {});

    const d = await store.drillItems();
    const it = d.items.find((i) => i.id === item.id)!;
    assert.ok(it, "captured item is due");
    assert.equal(it.new, true);
    assert.deepEqual(it.preview, [1, 1, 1, 1, 1, 1], "a new item comes back tomorrow whatever the grade");
    assert.equal(d.due, d.items.length);

    const res = await fetch(`${base}/drill/${TOKEN}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const html = await res.text();
    assert.match(html, /la ciotola/);
    assert.ok(!html.includes("</script><b>"), "item text can't close the data script");

    const grade = (body: unknown, token = TOKEN) =>
      fetch(`${base}/drill/${token}/grade`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await grade({ id: item.id, grade: 4 }, "wrong-token")).status, 404);
    assert.equal((await grade({ id: item.id, grade: 7 })).status, 400);
    assert.equal((await grade({ id: 999999, grade: 3 })).status, 400);

    const r = await grade({ id: item.id, grade: 4, answer: "la ciotola" });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.passed, true);
    assert.equal(body.interval_days, 1);
    const { rows } = await db.query("select mode, prompt, answer, session_id from attempts where item_id = $1", [item.id]);
    assert.deepEqual(rows, [{ mode: "screen", prompt: "the bowl", answer: "la ciotola", session_id: null }], "not attached to the open voice session");
    assert.ok(!(await store.drillItems()).items.some((i) => i.id === item.id), "graded item is no longer due");
    await call("end_session", { session_id: open.session_id });
  });

  test("poster page: the most forgotten words first, token-guarded", async () => {
    assert.equal((await fetch(`${base}/poster/wrong-token`)).status, 404);
    const store = new Store(db, TZ);
    const easy = (await store.captureItem({ italian: "facile", english: "easy", source: "asked" })).item.id;
    const hard = (await store.captureItem({ italian: "difficilissimo", english: "very hard", source: "asked" })).item.id;
    await store.recordAttempt({ item_id: easy, mode: "screen", answer: "", grade: 5, fillers: 0 });
    for (const grade of [1, 0, 4, 1]) await store.recordAttempt({ item_id: hard, mode: "screen", answer: "", grade, fillers: 0 });

    const { words } = await store.forgettable(50);
    assert.equal(words[0].italian, "difficilissimo");
    assert.equal(words[0].lapses, 3);
    assert.deepEqual(words[0].grades, [1, 0, 4, 1], "history oldest first");
    assert.ok(!words.some((w) => w.italian === "facile"), "a word never forgotten, ease intact, is left off");

    const res = await fetch(`${base}/poster/${TOKEN}?layout=cards&n=8&size=a3`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const html = await res.text();
    assert.match(html, /difficilissimo/);
    assert.match(html, /class="sheet cards"/);
  });

  test("atlas and screensaver: every view of the words, wrong answers diffed, token-guarded", async () => {
    assert.equal((await fetch(`${base}/atlas/wrong-token`)).status, 404);
    assert.equal((await fetch(`${base}/ambient/wrong-token`)).status, 404);
    const store = new Store(db, TZ);
    const id = (await store.captureItem({ italian: "la pellicola", english: "the film", note: "feminine", source: "asked" })).item.id;
    await store.recordAttempt({ item_id: id, mode: "screen", answer: "la pelicola", grade: 1, fillers: 0 });
    await store.recordAttempt({ item_id: id, mode: "screen", answer: "La pellicola", grade: 2, fillers: 0 });

    const a = await store.atlas();
    const w = a.words.find((x) => x.id === id)!;
    assert.deepEqual([w.attempts, w.lapses, w.reps, w.due], [2, 2, 0, false]);
    const m = a.mistakes.find((x) => x.id === id)!;
    assert.deepEqual(m.wrong.map((x) => x.answer), ["la pelicola"], "an answer that is the word itself is not a mistake");

    for (const view of ["sky", "garden", "cloud", "mistakes"]) {
      const res = await fetch(`${base}/atlas/${TOKEN}?view=${view}`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.match(await res.text(), /la pel/);
    }
    assert.match(await (await fetch(`${base}/atlas/${TOKEN}?view=mistakes`)).text(), /<ins>l<\/ins>/);
    const amb = await fetch(`${base}/ambient/${TOKEN}?every=30`);
    assert.equal(amb.status, 200);
    assert.match(await amb.text(), /"every":30/);
  });

  test("photos: search and choose on the Words page, fill the poster, serve, remove", async () => {
    const store = new Store(db, TZ);
    const id = (await store.searchItems("difficilissimo")).items[0].id;

    // Search: the query defaults to the English meaning; candidates carry a credit.
    let page = await (await fetch(`${base}/items/${TOKEN}?q=difficilissimo&photos=${id}`)).text();
    assert.match(page, /name="pq" value="very hard"/);
    assert.match(page, /960px-very_hard\.jpg/);
    assert.match(page, /Ugo Foto \/ Wikimedia Commons, CC BY 4.0/);
    const cand = page.match(/name="cand" value="([^"]+)"/)![1].replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    page = await (await fetch(`${base}/items/${TOKEN}?q=difficilissimo&photos=${id}&pq=nothing`)).text();
    assert.match(page, /Nothing found for “nothing”/);

    // Choose it: downloaded and stored.
    const post = (body: Record<string, string>) =>
      fetch(`${base}/items/${TOKEN}/${id}`, { method: "POST", body: new URLSearchParams({ q: "", filter: "all", ...body }), redirect: "manual" });
    let res = await post({ action: "photo", cand, pq: "very hard" });
    assert.match(res.headers.get("location") ?? "", /msg=Photo\+saved/);
    const saved = (await db.query("select mime, source, author, license, query, length(data)::int as n from pictures where item_id = $1", [id])).rows[0];
    assert.deepEqual(saved, { mime: "image/jpeg", source: "wikimedia", author: "Ugo Foto", license: "CC BY 4.0", query: "very hard", n: JPEG.length });
    res = await post({ action: "photo", cand: JSON.stringify({ source: "pexels", full: "http://127.0.0.1/secret" }) });
    assert.match(new URL(res.headers.get("location")!, base).searchParams.get("err") ?? "", /bad photo choice/);

    // Served behind the token, with its type.
    const pic = await fetch(`${base}/pic/${TOKEN}/${id}?v=1`);
    assert.equal(pic.status, 200);
    assert.equal(pic.headers.get("content-type"), "image/jpeg");
    assert.deepEqual(Buffer.from(await pic.arrayBuffer()), JPEG);
    assert.equal((await fetch(`${base}/pic/wrong-token/${id}`)).status, 404);
    assert.equal((await fetch(`${base}/pic/${TOKEN}/999999`)).status, 404);

    // The poster shows it with its credit, and fills in the rest on request.
    page = await (await fetch(`${base}/poster/${TOKEN}?layout=pictures&n=24`)).text();
    assert.match(page, new RegExp(`/pic/${TOKEN}/${id}\\?v=\\d+`));
    assert.match(page, /Ugo Foto \/ Wikimedia Commons, CC BY 4.0/);
    const missing = (await store.forgettable(24)).words.filter((w) => w.pic === null).length;
    assert.ok(missing > 0);
    res = await fetch(`${base}/poster/${TOKEN}/photos`, { method: "POST", body: new URLSearchParams({ layout: "pictures", n: "24", size: "a4", ink: "color" }), redirect: "manual" });
    const back = new URL(res.headers.get("location")!, base);
    assert.equal(back.searchParams.get("layout"), "pictures");
    assert.equal(back.searchParams.get("msg"), `Added ${missing} ${missing === 1 ? "photo" : "photos"}.`);
    assert.equal((await store.forgettable(24)).words.filter((w) => w.pic === null).length, 0);

    // Remove it again.
    await post({ action: "nophoto" });
    assert.equal((await db.query("select 1 from pictures where item_id = $1", [id])).rowCount, 0);
  });

  test("game page: words, scores and missed words to today's drill", async () => {
    assert.equal((await fetch(`${base}/game/wrong-token`)).status, 404);
    const res = await fetch(`${base}/game/${TOKEN}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const html = await res.text();
    assert.match(html, /Lampo/);
    assert.match(html, /aria-current="page">Game</);

    const post = (path: string, body: unknown) =>
      fetch(`${base}/game/${TOKEN}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    await db.query("delete from game_rounds");
    const first = await (await post("score", { score: 120, answered: 14, correct: 11, streak: 6 })).json();
    assert.deepEqual(first, { best: 120, previous: null, plays: 1, record: true });
    const second = await (await post("score", { score: 90, answered: 12, correct: 9, streak: 4 })).json();
    assert.equal(second.record, false);
    assert.equal(second.best, 120);
    assert.equal((await post("score", { score: 10, answered: 1, correct: 2, streak: 0 })).status, 400, "more right than answered");
    assert.equal((await post("score", { score: -1, answered: 0, correct: 0, streak: 0 })).status, 400);
    const store = new Store(db, TZ);
    assert.equal((await store.gameItems()).best, 120);

    const { rows } = await db.query(
      `insert into items (italian, english, source, interval_days, repetitions, due_on)
       values ('il ventaglio', 'the fan', 'asked', 12, 3, current_date + 9) returning id::int as id`,
    );
    const id = rows[0].id;
    assert.deepEqual(await (await post("due", { ids: [id] })).json(), { count: 1 });
    const after = await db.query("select due_on, interval_days, repetitions from items where id = $1", [id]);
    assert.equal(after.rows[0].due_on, today(TZ), "due today");
    assert.equal(after.rows[0].repetitions, 3, "learning progress kept");
    assert.equal((await post("due", { ids: "x" })).status, 400);
  });

  test("palazzo page: every word on the shelves, hardest first when capped, missed words to today's drill", async () => {
    assert.equal((await fetch(`${base}/palazzo/wrong-token`)).status, 404);
    const res = await fetch(`${base}/palazzo/${TOKEN}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const html = await res.text();
    assert.match(html, /<title>Il Palazzo<\/title>/);
    assert.match(html, /aria-current="page">Palazzo</);

    const { rows } = await db.query(
      `insert into items (italian, english, source, ease, interval_days, repetitions, due_on) values
         ('lo sgabello', 'the stool', 'asked', 1.3, 30, 4, current_date + 20),
         ('la mensola', 'the shelf', 'asked', 2.5, 2, 1, current_date - 1)
       returning id::int as id`,
    );
    const store = new Store(db, TZ);
    const all = await store.palazzoItems();
    const stool = all.items.find((i) => i.id === rows[0].id)!;
    assert.equal(all.total, all.items.length);
    assert.deepEqual([stool.interval_days, stool.repetitions, stool.due], [30, 4, false]);
    const two = await store.palazzoItems(2);
    assert.equal(two.items.length, 2);
    assert.ok(two.total > 2);
    assert.ok(two.items.every((i) => i.due), "due words are kept first");

    const due = await fetch(`${base}/palazzo/${TOKEN}/due`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [rows[0].id] }) });
    assert.deepEqual(await due.json(), { count: 1 });
    const after = await db.query("select due_on, interval_days from items where id = $1", [rows[0].id]);
    assert.equal(after.rows[0].due_on, today(TZ));
    assert.equal(after.rows[0].interval_days, 30, "learning progress kept");
  });

  test("Il Caso: open a case, episodes follow memory, finale only when every clue is secured", async () => {
    await db.query("delete from cases");
    assert.equal((await call("start_session", {})).case, null);
    const ins = await db.query(
      `insert into items (italian, english, source, repetitions, interval_days, due_on) values
         ('il cofano', 'the car bonnet', 'fallback', 2, 6, $1::date - 1),
         ('la targa', 'the number plate', 'asked', 0, 0, $1::date - 1),
         ('il ventaglio rosso', 'the red fan', 'asked', 1, 1, $1::date + 1)
       returning id::int as id`,
      [today(TZ)], // the tutor's day, not the database's: they differ around midnight
    );
    const [tailgate, wrap, fan] = ins.rows.map((r) => r.id as number);

    const none = await call("get_case");
    assert.equal(none.case, null);
    assert.ok(none.candidate_clues.length >= 3);
    assert.match(none.instruction, /open_case/);

    const opened = await call("open_case", {
      title: "La Vespa <rubata>",
      premise: "Una Vespa sparisce da un garage di Bologna.",
      solution: "Il portiere: ha forzato il cofano, ha cambiato la targa, ha perso il ventaglio rosso.",
      clue_ids: [tailgate, wrap, fan],
    });
    assert.equal(opened.case.episode, 1);
    assert.match(opened.case.solution, /portiere/);
    assert.deepEqual(opened.case.events, []);
    assert.deepEqual(opened.case.clues.map((c: { progress: string }) => c.progress), ["2/4", "0/4", "1/4"]);
    assert.ok(opened.case.clues[0].due_today && !opened.case.clues[2].due_today);
    const again = await call("open_case", { title: "x", premise: "x", solution: "x", clue_ids: [tailgate, wrap, fan] });
    assert.ok(again._isError && /already open/.test(again.error));
    assert.ok((await call("open_case", { title: "x", premise: "x", solution: "x", clue_ids: [tailgate, tailgate, wrap] }))._isError, "3 different clues");

    const s = await call("start_session", {});
    assert.deepEqual(s.case, { title: "La Vespa <rubata>", next_episode: 1, clues_secured: "0/3", due_clues: 2, solvable: false });

    // The tailgate lapses, the wrap gets secured: a setback and a breakthrough.
    await db.query("update items set repetitions = 0, interval_days = 1 where id = $1", [tailgate]);
    await db.query("update items set repetitions = 4, interval_days = 30 where id = $1", [wrap]);
    const ep1 = await call("get_case");
    assert.equal(ep1.case.events.length, 2);
    assert.match(ep1.case.events[0], /"il cofano" went cold.*setback/);
    assert.match(ep1.case.events[1], /"la targa" is now secured/);
    assert.equal(ep1.case.solvable, false);

    const early = await call("save_episode", { case_id: opened.case.case_id, headline: "x", story_so_far: "x", outcome: "solved" });
    assert.ok(early._isError && /il cofano, il ventaglio rosso not secured/.test(early.error));
    const saved = await call("save_episode", { case_id: opened.case.case_id, headline: "Il portiere mente", story_so_far: "Il detective scopre un garage forzato." });
    assert.equal(saved.episode, 1);
    const ep2 = await call("get_case");
    assert.equal(ep2.case.episode, 2);
    assert.deepEqual(ep2.case.events, [], "events are relative to the last saved episode");
    assert.equal(ep2.case.story_so_far, "Il detective scopre un garage forzato.");

    const board = await (await fetch(`${base}/case/${TOKEN}`)).text();
    assert.match(board, /La Vespa &lt;rubata&gt;/);
    assert.match(board, /Il portiere mente/);
    assert.match(board, /Sigillata/);
    assert.ok(!board.includes("perso il ventaglio"), "the solution stays sealed while the case is open");
    assert.match(await (await fetch(`${base}/stats/${TOKEN}`)).text(), /Il Caso: <span lang="it">La Vespa &lt;rubata&gt;/);
    assert.equal((await fetch(`${base}/case/wrong-token`)).status, 404);

    // Every clue secured: the finale, then the case closes.
    await db.query("update items set repetitions = 4, interval_days = 25 where id = any($1::bigint[])", [[tailgate, wrap, fan]]);
    const finale = await call("get_case");
    assert.equal(finale.case.solvable, true);
    assert.match(finale.instruction, /finale/);
    const solved = await call("save_episode", { case_id: opened.case.case_id, headline: "Il portiere confessa", story_so_far: "Caso chiuso.", outcome: "solved" });
    assert.equal(solved.closed, "solved");
    assert.equal((await call("get_case")).case, null);
    const archive = await (await fetch(`${base}/case/${TOKEN}`)).text();
    assert.match(archive, /Risolto/);
    assert.match(archive, /perso il ventaglio rosso/, "the archive reveals the solution");
  });

  test("drill word list: bearer only, due first, short items only, no grading", async () => {
    const store = new Store(db, TZ);
    await store.captureItem({ italian: "il semaforo", english: "the traffic light", source: "asked" });
    await store.captureItem({ italian: "non me lo sarei mai aspettato davvero", english: "I'd never have expected it", source: "error" });
    await db.query(`update items set due_on = current_date + 30 where italian = 'tragitto'`);
    const get = (qs = "", auth = `Bearer ${TOKEN}`) => fetch(`${base}/api/drill${qs}`, { headers: { authorization: auth } });

    assert.equal((await get("", "Bearer nope")).status, 401);
    const res = await get("?limit=100");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const { items, due } = (await res.json()) as { items: { italian: string; english: string; due: boolean }[]; due: number };
    const names = items.map((i) => i.italian);
    assert.ok(names.includes("il semaforo"));
    assert.ok(names.includes("tragitto"), "not-due items top up the list");
    assert.ok(!names.some((n) => n.split(" ").length > 4), "long items wait for sentence mode");
    assert.equal(due, items.filter((i) => i.due).length);
    assert.equal(items.find((i) => i.italian === "tragitto")?.due, false);

    const one = (await (await get("?limit=1")).json()) as { items: { due: boolean }[] };
    assert.equal(one.items.length, 1);
    assert.equal(one.items[0].due, true, "due items are picked before others");
    assert.equal((await db.query("select 1 from attempts a join items i on i.id = a.item_id where i.italian = 'il semaforo'")).rowCount, 0);
  });

  test("errors come back as tool errors, not crashes", async () => {
    const r = await call("record_attempt", { item_id: 999999, mode: "word", answer: "x", grade: 5, fillers: 0 });
    assert.equal(r._isError, true);
    assert.match(r.error, /not found/);
    const bad = await client.callTool({ name: "capture_item", arguments: { italian: "x", english: "y", source: "nope" } });
    assert.equal(bad.isError, true);
  });
});

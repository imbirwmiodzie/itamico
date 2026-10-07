import assert from "node:assert/strict";
import { test } from "node:test";
import { renderDrill } from "../src/drill.js";

const item = { id: 1, italian: "il tragitto", english: "</script><script>alert(1)</script>", note: null, context: null, example: null, new: true, overdue: 2, preview: [1, 1, 1, 1, 1, 1] };

test("drill page embeds items so they can't break out of the script", () => {
  const html = renderDrill("tok/en", { today: "2026-10-06", items: [item], due: 1, next: null });
  assert.ok(!html.includes("<script>alert(1)"), "text is escaped inside the JSON block");
  const json = html.match(/<script type="application\/json" id="data">(.*?)<\/script>/s)![1];
  const data = JSON.parse(json);
  assert.equal(data.items[0].english, item.english, "round-trips intact");
  assert.equal(data.post, "/drill/tok%2Fen/grade");
  assert.match(html, /<section id="empty"[^>]* hidden>/, "empty state hidden when something is due");
});

test("drill page with nothing due shows when the next words come", () => {
  const html = renderDrill("t", { today: "2026-10-06", items: [], due: 0, next: { day: "2026-10-08", count: 3 } });
  assert.match(html, /Tutto fatto!/);
  assert.match(html, /3 words on 8 Oct/);
  assert.match(html, /<section id="empty" class="flash panel">/);
});

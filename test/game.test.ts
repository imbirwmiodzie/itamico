import assert from "node:assert/strict";
import { test } from "node:test";
import { renderGame, traps } from "../src/game.js";

test("traps: learner-style look-alikes, never the word itself", () => {
  const t = traps("la pellicola");
  assert.ok(t.includes("il pellicola"), "article");
  assert.ok(t.includes("la pellicolo"), "ending");
  assert.ok(t.includes("la pelicola"), "double consonant dropped");
  assert.ok(t.includes("la pellicolla"), "single consonant doubled");
  assert.ok(!t.some((x) => x.toLowerCase() === "la pellicola"));
  assert.ok(traps("perché").includes("perche"), "accent dropped");
  assert.ok(traps("perché").includes("perchè"), "wrong accent");
  assert.ok(traps("il ghiaccio").includes("il giaccio"), "gh → g");
  assert.ok(traps("la cena").includes("la chena"), "c → ch");
  assert.ok(traps("la pellicola").length <= 8);
});

test("traps: no right answers among the wrong ones", () => {
  assert.deepEqual(traps("stanco"), [], "a bare adjective keeps its ending");
  assert.ok(!traps("l'amica").includes("l'amico"), "l' has no gender");
  assert.ok(traps("l'amica").includes("la amica"), "but the elision is tested");
  assert.ok(!traps("il cane", new Set(["la cane"])).includes("la cane"), "another word in the list is never a trap");
  assert.deepEqual(traps("non vedo l'ora di partire"), [], "long phrases are skipped");
  assert.ok(!traps("la casa").includes("lla casa"), "the article's consonant isn't doubled");
});

test("game page: data can't break out of the script, too few words says so", () => {
  const item = (id: number, italian: string) => ({ id, italian, english: "</script><script>alert(1)</script>", ease: 2.5, due: false, lapses: 0, pic: null });
  const html = renderGame("tok/en", { items: [1, 2, 3, 4].map((i) => item(i, `la parola${i}`)), best: 120, plays: 3 });
  assert.ok(!html.includes("<script>alert(1)"));
  const data = JSON.parse(html.match(/<script type="application\/json" id="data">(.*?)<\/script>/s)![1]);
  assert.equal(data.items.length, 4);
  assert.equal(data.score, "/game/tok%2Fen/score");
  assert.ok(data.items[0].traps.length >= 3);
  assert.match(html, /Best <b>120<\/b> · 3 rounds played/);

  const few = renderGame("t", { items: [item(1, "il cane")], best: 0, plays: 0 });
  assert.match(few, /needs at least 4 words; you have 1/);
  assert.ok(!few.includes('id="start"'));
});

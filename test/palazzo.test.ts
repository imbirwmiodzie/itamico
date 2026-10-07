import assert from "node:assert/strict";
import { test } from "node:test";
import { GALLERY_MAX, renderPalazzo, shelfKey, stage } from "../src/palazzo.js";
import type { PalazzoWord } from "../src/store.js";

const word = (id: number, italian: string, extra: Partial<PalazzoWord> = {}): PalazzoWord => ({
  id, italian, english: `meaning ${id}`, note: null, context: null, example: null, ease: 2.5, interval_days: 0, repetitions: 0, due: false, lapses: 0, pic: null, ...extra,
});
const dataOf = (html: string) => JSON.parse(html.match(/<script type="application\/json" id="data">(.*?)<\/script>/s)![1]);

test("shelfKey: shelved by the noun, without articles or accents", () => {
  assert.equal(shelfKey("la pellicola"), "pellicola");
  assert.equal(shelfKey("Lo schermo"), "schermo");
  assert.equal(shelfKey("gli occhiali"), "occhiali");
  assert.equal(shelfKey("l'amica"), "amica");
  assert.equal(shelfKey("l’ombrello"), "ombrello");
  assert.equal(shelfKey("un'amica"), "amica");
  assert.equal(shelfKey("perché"), "perche");
  assert.equal(shelfKey("a malapena"), "a malapena", "a preposition is not an article");
  assert.equal(shelfKey("la"), "la", "a bare article stays");
  assert.equal(shelfKey("i"), "i");
});

test("stage: same buckets as the stats page", () => {
  assert.equal(stage({ repetitions: 0, interval_days: 0 }), 0);
  assert.equal(stage({ repetitions: 2, interval_days: 6 }), 1);
  assert.equal(stage({ repetitions: 3, interval_days: 7 }), 2);
  assert.equal(stage({ repetitions: 4, interval_days: 20 }), 2);
  assert.equal(stage({ repetitions: 5, interval_days: 21 }), 3);
});

test("palazzo page: alphabetical shelves, hardest photos in the gallery, safe data", () => {
  const items = [
    word(1, "il ventaglio"),
    word(2, "l'amica", { pic: 100, ease: 2.5 }),
    word(3, "la cena", { pic: 200, ease: 1.3, due: true, repetitions: 3, interval_days: 30 }),
    word(4, "</script><script>alert(1)</script>"),
    ...Array.from({ length: GALLERY_MAX + 5 }, (_, i) => word(10 + i, `la parola${String(i).padStart(2, "0")}`, { pic: 300 + i, ease: 2.4 })),
  ];
  const html = renderPalazzo("tok/en", { items, total: items.length + 7 });
  assert.ok(!html.includes("<script>alert(1)"));
  const d = dataOf(html);
  assert.equal(d.due, "/palazzo/tok%2Fen/due");
  assert.equal(d.pics, "/pic/tok%2Fen/");
  const order = d.items.map((i: { it: string }) => i.it);
  assert.deepEqual(order.slice(0, 2), ["l'amica", "la cena"], "shelved by noun: amica, cena, …");
  assert.equal(order[order.length - 1], "il ventaglio");
  assert.ok(order.indexOf("la parola28") < order.indexOf("</script><script>alert(1)</script>"), "leading symbols are skipped: shelved under s");
  const cena = d.items.find((i: { id: number }) => i.id === 3);
  assert.deepEqual([cena.k, cena.st, cena.due, cena.g], ["C", 3, true, true]);
  const hung = d.items.filter((i: { g: boolean }) => i.g);
  assert.equal(hung.length, GALLERY_MAX);
  assert.ok(!d.items.find((i: { id: number }) => i.id === 2).g, "the easiest photo is left out of a full gallery");
  assert.match(html, /aria-current="page">Palazzo</);
  assert.match(html, /The \d+ hardest and due of your \d+ words are on the shelves/);
  assert.match(html, /find 10 words/);
});

test("palazzo page: an empty library says so, one word can't be hunted", () => {
  const empty = renderPalazzo("t", { items: [], total: 0 });
  assert.match(empty, /The shelves are empty/);
  assert.ok(!empty.includes("Passeggiata <span>"));
  const one = renderPalazzo("t", { items: [word(1, "il cane")], total: 1 });
  assert.match(one, /data-mode="hunt" disabled/);
  assert.ok(!one.includes("Words with a photo also hang"));
});

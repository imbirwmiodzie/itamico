import assert from "node:assert/strict";
import { test } from "node:test";
import { markWord, posterOptions, renderPoster } from "../src/poster.js";
import type { ForgettableWord } from "../src/store.js";

const w = (i: number, extra: Partial<ForgettableWord> = {}): ForgettableWord => ({
  id: i, italian: `parola${i}`, english: `word ${i}`, note: null, context: null, ease: 1.8,
  attempts: 4, lapses: 2, last_lapse: "2026-10-01", grades: [1, 4, 0, 5], score: 3, ...extra,
});

test("markWord bolds whole words only, falling back to the word without its article", () => {
  assert.equal(markWord("Vado sulla pista ciclabile.", "la pista ciclabile"), "Vado sulla <b>pista ciclabile</b>.");
  assert.equal(markWord("Metti la frutta nella ciotola.", "la ciotola"), "Metti la frutta nella <b>ciotola</b>.");
  assert.equal(markWord("Non so perché è chiuso.", "perché"), "Non so <b>perché</b> è chiuso.");
  assert.equal(markWord("Il casco? Il casco!", "il casco"), "<b>Il casco</b>? <b>Il casco</b>!");
  assert.equal(markWord("<i>casco</i>", "casco"), "&lt;i&gt;<b>casco</b>&lt;/i&gt;", "escaped around the mark");
  assert.equal(markWord("Frena prima della curva.", "frenare"), "Frena prima della curva.");
});

test("posterOptions falls back to defaults for unknown values", () => {
  assert.deepEqual(posterOptions({}), { size: "a4", layout: "poster", n: 16, ink: "color" });
  assert.deepEqual(posterOptions({ size: "a3", layout: "cards", n: "24", ink: "mono" }), { size: "a3", layout: "cards", n: 24, ink: "mono" });
  assert.deepEqual(posterOptions({ size: "a0", layout: "x", n: "999", ink: "gold" }), { size: "a4", layout: "poster", n: 16, ink: "color" });
  assert.equal(posterOptions({ layout: "cards" }).n, 8);
});

test("poster renders every word once, ranked, with escaped text", () => {
  const words = Array.from({ length: 16 }, (_, i) => w(i + 1));
  words[0] = w(1, { italian: "<script>x</script>", context: "a <script>x</script> b" });
  const html = renderPoster("tok", posterOptions({}), { today: "2026-10-06", words });
  assert.ok(!html.includes("<script>x"), "user text escaped");
  assert.equal(html.match(/<article class="w /g)!.length, 16);
  assert.equal(html.match(/class="sheet /g)!.length, 1);
  assert.match(html, /forgotten 32 times in all/);
  assert.match(html, /@page\{size:210mm 297mm/);
});

test("cut-out cards: eight to a sheet, the last sheet padded with blanks", () => {
  const words = Array.from({ length: 12 }, (_, i) => w(i + 1));
  const html = renderPoster("tok", posterOptions({ layout: "cards", n: "12", size: "letter" }), { today: "2026-10-06", words });
  assert.equal(html.match(/class="sheet cards"/g)!.length, 2);
  assert.equal(html.match(/class="w cd blank"/g)!.length, 4);
  assert.match(html, /@page\{size:215.9mm 279.4mm/);
});

test("with nothing forgotten the page says so and prints nothing", () => {
  const html = renderPoster("tok", posterOptions({}), { today: "2026-10-06", words: [] });
  assert.match(html, /Nothing to put up yet/);
  assert.ok(!html.includes('class="sheet'));
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Atlas, type AtlasWord, ambientOptions, ambientWords, atlasView, charDiff, constellations, mistakeKind, placeStars,
  renderAmbient, renderAtlas, stage,
} from "../src/atlas.js";

const w = (id: number, extra: Partial<AtlasWord> = {}): AtlasWord => ({
  id, italian: `parola${id}`, english: `word ${id}`, note: null, context: null, example: null, ease: 2.5, interval: 0, reps: 0,
  overdue: 0, due: true, created: "2026-09-01", attempts: 0, lapses: 0, pic: null, ...extra,
});
const atlas = (words: AtlasWord[], mistakes: Atlas["mistakes"] = []): Atlas => ({ today: "2026-10-06", words, mistakes });

test("stage follows the review interval, a lapse is a seed again", () => {
  assert.deepEqual(
    [[0, 0], [1, 1], [2, 6], [3, 7], [5, 20], [8, 21], [9, 89], [10, 90], [0, 30]].map(([reps, interval]) => stage({ reps, interval })),
    [0, 1, 2, 3, 3, 4, 4, 5, 0],
  );
});

test("charDiff marks letters left out and said instead, ignoring case", () => {
  const join = (want: string, said: string) =>
    charDiff(want, said).map((g) => (g.t === "=" ? g.s : g.t === "+" ? `[+${g.s}]` : `[-${g.s}]`)).join("");
  assert.equal(join("stanco", "stanca"), "stanc[+a][-o]");
  assert.equal(join("il problema", "la problema"), "[+la][-il] problema", "a one-letter match inside a swap joins it");
  assert.equal(join("l'incrocio", "il incrocio"), "[+il ][-l']incrocio");
  assert.equal(join("pellicola", "pelicola"), "pel[-l]icola");
  assert.equal(join("Casco", "casco"), "casco");
  // Rebuilding both sides from the segments gives back the inputs.
  for (const [a, b] of [["la ciotola", "il ciottolo"], ["perché", "perche"], ["", "x"], ["abc", ""]]) {
    const segs = charDiff(a, b);
    assert.equal(segs.filter((g) => g.t !== "+").map((g) => g.s).join("").toLowerCase(), a.toLowerCase());
    assert.equal(segs.filter((g) => g.t !== "-").map((g) => g.s).join(""), b);
  }
});

test("mistakeKind names the smallest difference", () => {
  assert.equal(mistakeKind("perché", "perche"), "accent");
  assert.equal(mistakeKind("il problema", "la problema"), "article");
  assert.equal(mistakeKind("stanco", "stanca"), "ending");
  assert.equal(mistakeKind("la pellicola", "la pelicola"), "spelling");
  assert.equal(mistakeKind("il casco", "il cappello"), "other");
});

test("constellations: notes shared by two or more words, case-insensitive", () => {
  const ws = [w(1, { note: "Feminine" }), w(2, { note: "feminine " }), w(3, { note: "masculine" }), w(4)];
  assert.deepEqual([...constellations(ws)].map(([k, v]) => [k, v.map((x) => x.id)]), [["feminine", [1, 2]]]);
});

test("stars sit nearer the sun the shorter the interval, inside the sky", () => {
  const ws = [w(1), w(2, { reps: 1, interval: 1 }), w(3, { reps: 4, interval: 30 }), w(4, { reps: 8, interval: 400 })];
  const { stars } = placeStars(ws);
  const r = (id: number) => stars.find((s) => s.w.id === id)!.r;
  assert.ok(r(1) < r(2) && r(2) < r(3) && r(3) < r(4));
  for (const s of stars) assert.ok(s.x > 0 && s.x < 720 && s.y > 0 && s.y < 720);
});

test("every view renders each word escaped, and empty states say so", () => {
  const ws = Array.from({ length: 40 }, (_, i) => w(i + 1, { reps: i % 6, interval: [0, 1, 4, 10, 40, 120][i % 6], attempts: i, lapses: i % 3, overdue: i % 7 }));
  ws[0] = w(1, { italian: "<script>x</script>", english: '"quoted"', note: "a<b" });
  ws[1] = w(2, { note: "a<b" });
  const mistakes = [{ id: 1, italian: "<script>x</script>", english: "e", count: 2, wrong: [{ answer: "<img onerror=x>", day: "2026-10-01" }] }];
  for (const view of ["sky", "garden", "cloud", "mistakes"] as const) {
    const html = renderAtlas(atlas(ws, mistakes), "tok", view);
    assert.ok(!html.includes("<script>x") && !html.includes("<img onerror"), `${view}: user text escaped`);
    assert.ok(!/NaN|undefined/.test(html), `${view}: no broken numbers`);
    assert.match(html, /aria-current="page"/);
  }
  assert.equal(renderAtlas(atlas(ws), "tok", "sky").match(/class="star /g)!.length, 40);
  assert.equal(renderAtlas(atlas(ws), "tok", "garden").match(/<figure class="plant/g)!.length, 40);
  assert.equal(renderAtlas(atlas(ws), "tok", "cloud").match(/class="cw /g)!.length, 40);
  assert.match(renderAtlas(atlas(ws), "tok", "garden"), /needs water/);
  assert.match(renderAtlas(atlas([]), "tok", "garden"), /No words yet/);
  assert.match(renderAtlas(atlas(ws), "tok", "mistakes"), /No wrong answers recorded yet/);
  assert.equal(atlasView("nope"), "sky");
});

test("ambient: options clamped, open words first, data safe in the page", () => {
  assert.deepEqual(ambientOptions({}), { every: 20, reveal: 7, n: 30, side: "italian" });
  assert.deepEqual(ambientOptions({ every: "1", reveal: "99", n: "1000", side: "english" }), { every: 5, reveal: 5, n: 200, side: "english" });
  const ws = [
    w(1, { reps: 9, interval: 200, due: false }),
    ...Array.from({ length: 6 }, (_, i) => w(i + 2, { reps: 1, interval: 3, due: i === 5, lapses: i })),
  ];
  const picked = ambientWords(ws, 10);
  assert.ok(!picked.some((x) => x.id === 1), "well-kept words left out");
  assert.equal(picked[0].id, 7, "due first");
  assert.equal(picked[1].id, 6, "then the most forgotten");
  const html = renderAmbient([w(1, { italian: "</script><b>", context: "c'è </script><b> qui" })], "tok", ambientOptions({}));
  assert.ok(!html.includes("</script><b>"));
  assert.match(renderAmbient([], "tok", ambientOptions({})), /No words to show yet/);
});

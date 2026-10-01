import assert from "node:assert/strict";
import { test } from "node:test";
import { capGrade, countFillers, sm2 } from "../src/grading.js";
import { normalizeItalian } from "../src/store.js";

const fresh = { ease: 2.5, interval_days: 0, repetitions: 0 };

test("sm2: passes grow 1, 6, then x ease", () => {
  let s = sm2(fresh, 5);
  assert.deepEqual(s, { ease: 2.6, interval_days: 1, repetitions: 1 });
  s = sm2(s, 5);
  assert.deepEqual(s, { ease: 2.7, interval_days: 6, repetitions: 2 });
  s = sm2(s, 5);
  assert.deepEqual(s, { ease: 2.8, interval_days: 17, repetitions: 3 });
});

test("sm2: q=4 keeps ease, q=3 lowers it and grows more slowly", () => {
  const s = { ease: 2.5, interval_days: 6, repetitions: 2 };
  assert.deepEqual(sm2(s, 4), { ease: 2.5, interval_days: 15, repetitions: 3 });
  assert.deepEqual(sm2(s, 3), { ease: 2.36, interval_days: 14, repetitions: 3 });
});

test("sm2: failure resets to one day and lowers ease", () => {
  const s = { ease: 2.5, interval_days: 40, repetitions: 5 };
  assert.deepEqual(sm2(s, 2), { ease: 2.18, interval_days: 1, repetitions: 0 });
  assert.deepEqual(sm2(s, 0), { ease: 1.7, interval_days: 1, repetitions: 0 });
});

test("sm2: ease is floored at 1.3", () => {
  assert.equal(sm2({ ease: 1.4, interval_days: 1, repetitions: 0 }, 0).ease, 1.3);
  assert.equal(sm2({ ease: 1.3, interval_days: 10, repetitions: 3 }, 3).ease, 1.3);
});

test("sm2: rejects out-of-range grades", () => {
  assert.throws(() => sm2(fresh, 6), RangeError);
  assert.throws(() => sm2(fresh, -1), RangeError);
  assert.throws(() => sm2(fresh, 2.5), RangeError);
});

test("countFillers finds filler sounds but not Italian words", () => {
  assert.equal(countFillers("eh, mi piacciono, ehm, uh... le mele"), 3);
  assert.equal(countFillers("Ehhh lo schermo, hmm, umm"), 3);
  assert.equal(countFillers("io e te, ah sì, è vero"), 0);
  assert.equal(countFillers(""), 0);
  assert.equal(countFillers(undefined), 0);
});

test("capGrade applies the hesitation rows of the grading table", () => {
  assert.equal(capGrade(5, 0), 5);
  assert.equal(capGrade(5, 1), 4);
  assert.equal(capGrade(5, 2), 4);
  assert.equal(capGrade(5, 3), 3);
  assert.equal(capGrade(4, 7), 3);
  assert.equal(capGrade(2, 5), 2);
  assert.equal(capGrade(0, 0), 0);
});

test("normalizeItalian tidies transcribed text", () => {
  assert.equal(normalizeItalian('  "Lo   schermo."  '), "Lo schermo");
  assert.equal(normalizeItalian("su una pista ciclabile!"), "su una pista ciclabile");
  assert.equal(normalizeItalian("l'aria è pungente"), "l'aria è pungente");
  assert.equal(normalizeItalian("un po'."), "un po'");
});

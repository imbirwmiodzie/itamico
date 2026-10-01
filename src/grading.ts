// SM-2 scheduling and the server-side checks on the grade the tutor assigns.
//
// The model assigns the SM-2 quality q (0..5) from the transcribed answer; the
// server applies the schedule. The server also enforces the hesitation rows of
// the grading table, so a hesitant answer can never be scheduled as fluent.

export const MIN_EASE = 1.3;

export interface Schedule {
  ease: number;
  interval_days: number;
  repetitions: number;
}

/**
 * Standard SM-2 step.
 *  q >= 3 (pass): interval 1, then 6, then previous interval x ease.
 *  q <  3 (fail): repetitions reset, interval back to 1 day.
 * Ease is updated by the SM-2 formula on every answer (so failures lower it),
 * floored at 1.3. The updated ease is used for the interval, so a low pass
 * (q = 3) grows the interval more slowly than a fluent one.
 */
export function sm2(prev: Schedule, q: number): Schedule {
  if (!Number.isInteger(q) || q < 0 || q > 5) throw new RangeError(`grade must be an integer 0..5, got ${q}`);

  const d = 5 - q;
  const ease = Math.max(MIN_EASE, round2(prev.ease + (0.1 - d * (0.08 + d * 0.02))));

  if (q < 3) return { ease, interval_days: 1, repetitions: 0 };

  let interval_days: number;
  if (prev.repetitions === 0) interval_days = 1;
  else if (prev.repetitions === 1) interval_days = 6;
  else interval_days = Math.max(1, Math.round(Math.max(prev.interval_days, 1) * ease));

  return { ease, interval_days, repetitions: prev.repetitions + 1 };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Filler sounds as speech-to-text tends to write them: eh, ehm, ehhh, uh, uhm,
// um, umm, mm, hmm, ah... Italian "e" (and) and "ah" (as in "ah sì") are words,
// so they are deliberately not matched.
const FILLER = /^(e+h+m*|u+h+m*|u+m+|m{2,}|h+m+|e+r+m+)$/i;

/** Count filler tokens in a transcript. Approximate by design. */
export function countFillers(text: string | null | undefined): number {
  if (!text) return 0;
  return text
    .split(/[\s,.;:!?…"“”'()\-–—]+/u)
    .filter((t) => t && FILLER.test(t)).length;
}

/**
 * Cap a passing grade by the number of fillers, per the grading table:
 *   0 fillers   -> up to 5
 *   1-2 fillers -> at most 4
 *   3+ fillers  -> at most 3
 * Failing grades (< 3) are never raised.
 */
export function capGrade(q: number, fillers: number): number {
  if (q < 3) return q;
  if (fillers >= 3) return Math.min(q, 3);
  if (fillers >= 1) return Math.min(q, 4);
  return q;
}

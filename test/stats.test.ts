import assert from "node:assert/strict";
import { test } from "node:test";
import { heatLevel, heatRanges, renderStats, type Stats, streak } from "../src/stats.js";

test("streak counts consecutive days ending today or yesterday", () => {
  assert.equal(streak(["2026-10-04", "2026-10-03", "2026-10-02", "2026-09-30"], "2026-10-04"), 3);
  assert.equal(streak(["2026-10-03", "2026-10-02"], "2026-10-04"), 2, "today not practised yet keeps the streak");
  assert.equal(streak(["2026-10-02"], "2026-10-04"), 0);
  assert.equal(streak([], "2026-10-04"), 0);
  assert.equal(streak(["2026-03-01", "2026-02-28"], "2026-03-01"), 2, "month boundary");
});

test("heatmap levels and legend ranges agree", () => {
  for (const max of [1, 2, 3, 4, 7, 10, 36]) {
    const ranges = heatRanges(max);
    for (let v = 0; v <= max; v++) {
      const level = heatLevel(v, max);
      const r = ranges.find((x) => x.level === level);
      assert.ok(r, `max ${max}: level ${level} of ${v} has a legend entry`);
      const [lo, hi = lo] = r.text.split("–").map(Number);
      assert.ok(v >= lo && v <= hi, `max ${max}: ${v} falls in "${r.text}"`);
    }
  }
  assert.equal(heatLevel(0, 0), 0);
  assert.equal(heatLevel(36, 36), 4);
});

test("renders with no data and with data, without NaN", () => {
  const empty: Stats = {
    today: "2026-10-06",
    totals: { items: 0, due: 0, attempts: 0, activeDays: 0 },
    stages: ["a", "b", "c", "d"].map((label) => ({ label, count: 0 })),
    week: { attempts: 0, passRate: null, fillers: null, prevFillers: null },
    streak: 0,
    daily: Array.from({ length: 30 }, (_, i) => ({ day: `2026-09-${String(i + 1).padStart(2, "0")}`, passed: 0, failed: 0, fillers: null })),
    forecast: Array.from({ length: 14 }, (_, i) => ({ day: `2026-10-${String(i + 6).padStart(2, "0")}`, count: 0 })),
    hardest: [],
    recent: [],
    sources: {},
    calendar: Array.from({ length: 176 }, (_, i) => ({ day: "2026-10-01", answers: 0, passed: 0 })),
    hours: Array.from({ length: 7 }, () => Array(24).fill(0)),
    gaps: ["0", "1"].map((short) => ({ label: short, short, answers: 0, passed: 0 })),
    grades: Array(6).fill(0),
    growth: Array.from({ length: 90 }, () => ({ day: "2026-10-01", total: 0, added: 0 })),
  };
  const full: Stats = {
    ...empty,
    calendar: empty.calendar.map((d, i) => ({ ...d, answers: i % 5, passed: i % 3 })),
    hours: empty.hours.map((r, d) => r.map((_, h) => (h === 7 ? d + 1 : 0))),
    gaps: [{ label: "Same day", short: "0", answers: 3, passed: 2 }, { label: "1 day", short: "1", answers: 10, passed: 9 }],
    grades: [1, 2, 3, 4, 5, 6],
    growth: empty.growth.map((d, i) => ({ ...d, total: i, added: 1 })),
  };
  for (const s of [empty, full]) {
    const html = renderStats(s, "tok");
    assert.ok(!/NaN|undefined|Infinity/.test(html), "no NaN/undefined/Infinity in the output");
    for (const h of ["Practice calendar", "How answers were graded", "How well words stick", "When you practise", "Vocabulary growth"]) assert.match(html, new RegExp(h));
  }
  const html = renderStats(full, "tok");
  assert.match(html, /Busiest: Sun 07:00–08:00/);
  assert.match(html, /class="s1 faint"/, "a bucket with few answers is faded");
});

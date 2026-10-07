// Learning stats: the queries behind GET /stats/<token> and the page itself.
// Server-rendered HTML with inline SVG charts, no external assets: one request,
// works on a phone, nothing to install.

import type { Db } from "./db.js";
import { today } from "./db.js";
import { CASE_CARD_CSS, type CaseFile, caseCard } from "./case.js";
import { esc, nav, PAGE_CSS, TIP_CSS, TIP_HTML } from "./page.js";

export interface Stats {
  today: string;
  totals: { items: number; due: number; attempts: number; activeDays: number };
  stages: { label: string; count: number }[];
  week: { attempts: number; passRate: number | null; fillers: number | null; prevFillers: number | null };
  streak: number;
  daily: { day: string; passed: number; failed: number; fillers: number | null }[];
  forecast: { day: string; count: number }[];
  hardest: { italian: string; english: string; ease: number; attempts: number; fails: number; last: string }[];
  recent: { italian: string; english: string; note: string | null; example: string | null; context: string | null; source: string; captured: string }[];
  sources: Record<string, number>;
  /** One entry per day from a Monday CAL_WEEKS weeks back through today. */
  calendar: { day: string; answers: number; passed: number }[];
  /** Answers by [weekday Mon..Sun][hour 0..23], last HOUR_DAYS days. */
  hours: number[][];
  /** Pass rate by days since the same word's previous answer, one entry per GAPS bucket. */
  gaps: { label: string; short: string; answers: number; passed: number }[];
  /** Answers per grade 0..5, last DAYS days. */
  grades: number[];
  /** Words in the list at the end of each day, last GROWTH_DAYS days. */
  growth: { day: string; total: number; added: number }[];
}

const DAYS = 30;
const FORECAST_DAYS = 14;
const CAL_WEEKS = 26, CAL_WEEKS_NARROW = 15;
const HOUR_DAYS = 90;
const GROWTH_DAYS = 90;
// Upper bound (days) of each gap bucket; the last one is open-ended.
const GAPS = [
  { max: 0, label: "Same day", short: "0" },
  { max: 1, label: "1 day", short: "1" },
  { max: 3, label: "2–3 days", short: "2–3" },
  { max: 7, label: "4–7 days", short: "4–7" },
  { max: 14, label: "8–14 days", short: "8–14" },
  { max: 30, label: "15–30 days", short: "15–30" },
  { max: Infinity, label: "31+ days", short: "31+" },
];

export async function loadStats(db: Db, timeZone: string): Promise<Stats> {
  const day = today(timeZone);
  // A timestamp as a calendar day in the user's zone; tz is query parameter $p.
  const local = (col: string, p = 2) => `(${col} at time zone $${p})::date`;

  const calStart = addDays(day, -weekday(day) - 7 * (CAL_WEEKS - 1));
  const gapCase = GAPS.slice(0, -1).map((g, i) => `when gap <= ${g.max} then ${i}`).join(" ");

  const [totals, stages, daily, week, active, forecast, hardest, recent, sources, calendar, hours, gaps, grades, growth] = await Promise.all([
    db.query(
      `select count(*)::int as items,
              count(*) filter (where due_on <= $1)::int as due,
              (select count(*)::int from attempts) as attempts
         from items`,
      [day],
    ),
    db.query(
      `select count(*) filter (where repetitions = 0)::int as fresh,
              count(*) filter (where repetitions > 0 and interval_days < 7)::int as learning,
              count(*) filter (where repetitions > 0 and interval_days between 7 and 20)::int as young,
              count(*) filter (where repetitions > 0 and interval_days >= 21)::int as mature
         from items`,
    ),
    db.query(
      `with days as (select generate_series($1::date - ${DAYS - 1}, $1::date, interval '1 day')::date as d)
       select to_char(d, 'YYYY-MM-DD') as day,
              count(a.id) filter (where a.grade >= 3)::int as passed,
              count(a.id) filter (where a.grade < 3)::int as failed,
              round((avg(a.fillers) filter (where a.mode <> 'screen'))::numeric, 2)::float as fillers
         from days left join attempts a on ${local("a.at")} = d
        group by d order by d`,
      [day, timeZone],
    ),
    db.query(
      `select count(*) filter (where ${local("at")} > $1::date - 7)::int as attempts,
              avg((grade >= 3)::int) filter (where ${local("at")} > $1::date - 7)::float as pass_rate,
              avg(fillers) filter (where ${local("at")} > $1::date - 7 and mode <> 'screen')::float as fillers,
              avg(fillers) filter (where ${local("at")} <= $1::date - 7 and ${local("at")} > $1::date - 14 and mode <> 'screen')::float as prev_fillers
         from attempts where at > now() - interval '15 days'`,
      [day, timeZone],
    ),
    db.query(
      `select distinct to_char(${local("at", 1)}, 'YYYY-MM-DD') as day from attempts
        where at > now() - interval '400 days' order by 1 desc`,
      [timeZone],
    ),
    db.query(
      `select to_char(greatest(due_on, $1::date), 'YYYY-MM-DD') as day, count(*)::int as count
         from items where due_on <= $1::date + ${FORECAST_DAYS - 1}
        group by 1`,
      [day],
    ),
    db.query(
      `select i.italian, i.english, round(i.ease::numeric, 2)::float as ease,
              count(a.id)::int as attempts,
              count(a.id) filter (where a.grade < 3)::int as fails,
              to_char(max(${local("a.at", 1)}), 'YYYY-MM-DD') as last
         from items i join attempts a on a.item_id = i.id
        group by i.id
       having count(a.id) filter (where a.grade < 3) > 0
        order by fails desc, i.ease, i.italian
        limit 10`,
      [timeZone],
    ),
    db.query(
      `select italian, english, note, example, context, source, to_char(${local("last_captured_at", 1)}, 'YYYY-MM-DD') as captured
         from items order by last_captured_at desc, id desc limit 15`,
      [timeZone],
    ),
    db.query(`select source, count(*)::int as n from items group by source`),
    db.query(
      `select to_char(${local("at")}, 'YYYY-MM-DD') as day, count(*)::int as answers,
              count(*) filter (where grade >= 3)::int as passed
         from attempts where at > now() - interval '${CAL_WEEKS * 7 + 2} days' and ${local("at")} >= $1::date
        group by 1`,
      [calStart, timeZone],
    ),
    db.query(
      `select extract(isodow from at at time zone $1)::int as dow, extract(hour from at at time zone $1)::int as hour,
              count(*)::int as n
         from attempts where at > now() - interval '${HOUR_DAYS} days'
        group by 1, 2`,
      [timeZone],
    ),
    db.query(
      `with g as (
         select grade, ${local("at", 1)} - lag(${local("at", 1)}) over (partition by item_id order by at, id) as gap
           from attempts)
       select case ${gapCase} else ${GAPS.length - 1} end as bucket,
              count(*)::int as answers, count(*) filter (where grade >= 3)::int as passed
         from g where gap is not null group by 1`,
      [timeZone],
    ),
    db.query(
      `select grade, count(*)::int as n from attempts
        where at > now() - interval '${DAYS + 1} days' and ${local("at")} > $1::date - ${DAYS}
        group by grade`,
      [day, timeZone],
    ),
    db.query(`select to_char(${local("created_at", 1)}, 'YYYY-MM-DD') as day, count(*)::int as n from items group by 1`, [timeZone]),
  ]);

  const activeDays: string[] = active.rows.map((r) => r.day);
  const byDay = new Map(forecast.rows.map((r) => [r.day as string, r.count as number]));
  const s = stages.rows[0];
  const w = week.rows[0];
  const calByDay = new Map(calendar.rows.map((r) => [r.day as string, r]));
  const hourGrid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const r of hours.rows) hourGrid[r.dow - 1][r.hour] = r.n;
  const gapRows = new Map(gaps.rows.map((r) => [r.bucket as number, r]));
  const gradeCounts = Array<number>(6).fill(0);
  for (const r of grades.rows) gradeCounts[r.grade] = r.n;
  const growthStart = addDays(day, -(GROWTH_DAYS - 1));
  const addedByDay = new Map<string, number>(growth.rows.map((r) => [r.day, r.n]));
  let total = growth.rows.filter((r) => r.day < growthStart).reduce((a, r) => a + r.n, 0);

  return {
    today: day,
    totals: { ...totals.rows[0], activeDays: activeDays.length },
    stages: [
      { label: "Not recalled yet", count: s.fresh },
      { label: "Learning (under a week)", count: s.learning },
      { label: "Young (1–3 weeks)", count: s.young },
      { label: "Mature (3+ weeks)", count: s.mature },
    ],
    week: { attempts: w.attempts, passRate: w.pass_rate, fillers: w.fillers, prevFillers: w.prev_fillers },
    streak: streak(activeDays, day),
    daily: daily.rows,
    forecast: Array.from({ length: FORECAST_DAYS }, (_, i) => {
      const d = addDays(day, i);
      return { day: d, count: byDay.get(d) ?? 0 };
    }),
    hardest: hardest.rows,
    recent: recent.rows,
    sources: Object.fromEntries(sources.rows.map((r) => [r.source, r.n])),
    calendar: Array.from({ length: weekday(day) + 1 + 7 * (CAL_WEEKS - 1) }, (_, i) => {
      const d = addDays(calStart, i);
      const r = calByDay.get(d);
      return { day: d, answers: r?.answers ?? 0, passed: r?.passed ?? 0 };
    }),
    hours: hourGrid,
    gaps: GAPS.map((g, i) => ({ label: g.label, short: g.short, answers: gapRows.get(i)?.answers ?? 0, passed: gapRows.get(i)?.passed ?? 0 })),
    grades: gradeCounts,
    growth: Array.from({ length: GROWTH_DAYS }, (_, i) => {
      const d = addDays(growthStart, i);
      const added = addedByDay.get(d) ?? 0;
      total += added;
      return { day: d, total, added };
    }),
  };
}

/** Consecutive practice days ending today (or yesterday: today isn't over yet). */
export function streak(daysDesc: string[], todayStr: string): number {
  const set = new Set(daysDesc);
  let d = set.has(todayStr) ? todayStr : addDays(todayStr, -1);
  let n = 0;
  while (set.has(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

/** Day of the week, Monday = 0. */
function weekday(day: string): number {
  return (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
}

function addDays(day: string, n: number): string {
  const t = new Date(`${day}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ rendering

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const shortDate = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);
const num1 = (x: number | null) => (x === null ? "–" : x.toFixed(1));

/** A round axis maximum whose midpoint is a whole number too (counts are integers). */
function niceMax(v: number): number {
  if (v <= 4) return 4;
  const step = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 3, 4, 5, 6, 8, 10]) {
    const c = m * step;
    if (c >= v && Number.isInteger(c / 2)) return c;
  }
  return 10 * step;
}

/** Column path: square at the baseline, 4px rounded data end when `round`. */
function col(x: number, y: number, w: number, h: number, round: boolean): string {
  if (h <= 0) return "";
  const r = round ? Math.min(4, w / 2, h) : 0;
  return `M${x},${y + h}V${y + r}${r ? `Q${x},${y} ${x + r},${y}` : ""}H${x + w - r}${r ? `Q${x + w},${y} ${x + w},${y + r}` : ""}V${y + h}Z`;
}

// Charts are drawn twice, wide and narrow, and CSS shows one: an SVG viewBox
// scales its text with the chart, so one size can't stay readable on both a
// desktop and a phone.
const WIDE = 640, NARROW = 340;
const H = 200, PAD_L = 32, PAD_R = 8, PAD_T = 12, PAD_B = 24;

function axes(W: number, maxY: number, labels: { x: number; text: string }[], fmt = (v: number) => String(v)): string {
  const plotH = H - PAD_T - PAD_B;
  const ticks = [0, maxY / 2, maxY];
  return (
    ticks
      .map((t) => {
        const y = PAD_T + plotH - (t / maxY) * plotH;
        return `<line class="${t === 0 ? "base" : "grid"}" x1="${PAD_L}" x2="${W - PAD_R}" y1="${y}" y2="${y}"/>` +
          `<text class="tick" x="${PAD_L - 6}" y="${y + 4}" text-anchor="end">${fmt(t)}</text>`;
      })
      .join("") +
    labels.map((l) => `<text class="tick" x="${l.x}" y="${H - 6}" text-anchor="middle">${esc(l.text)}</text>`).join("")
  );
}

function answersChart(daily: Stats["daily"], W: number): string {
  const n = daily.length;
  const slot = (W - PAD_L - PAD_R) / n;
  const bw = Math.min(14, slot - (slot > 12 ? 4 : 2));
  const plotH = H - PAD_T - PAD_B;
  const maxY = niceMax(Math.max(1, ...daily.map((d) => d.passed + d.failed)));
  const y = (v: number) => (v / maxY) * plotH;
  let marks = "";
  daily.forEach((d, i) => {
    const x = PAD_L + i * slot + (slot - bw) / 2;
    const base = PAD_T + plotH;
    const hp = y(d.passed), hf = y(d.failed);
    const gap = d.passed && d.failed ? 2 : 0;
    marks += `<path class="s1" d="${col(x, base - hp, bw, hp, !d.failed)}"/>`;
    marks += `<path class="s2" d="${col(x, base - hp - gap - hf, bw, hf, true)}"/>`;
    const tip = `${shortDate(d.day)}|${d.passed + d.failed} answers|${d.passed} passed|${d.failed} failed`;
    marks += `<rect class="hit" x="${PAD_L + i * slot}" y="${PAD_T}" width="${slot}" height="${plotH}" data-tip="${esc(tip)}" tabindex="0"/>`;
  });
  const lab = [0, Math.floor(n / 2), n - 1].map((i) => ({ x: PAD_L + i * slot + slot / 2, text: shortDate(daily[i].day) }));
  return svg(W, axes(W, maxY, lab) + marks, "Answers per day, passed and failed");
}

function fillersChart(daily: Stats["daily"], W: number): string {
  const n = daily.length;
  const slot = (W - PAD_L - PAD_R) / n;
  const plotH = H - PAD_T - PAD_B;
  const vals = daily.map((d) => d.fillers);
  const maxY = Math.max(1, Math.ceil(Math.max(0, ...vals.map((v) => v ?? 0))));
  const px = (i: number) => PAD_L + i * slot + slot / 2;
  const py = (v: number) => PAD_T + plotH - (v / maxY) * plotH;
  let path = "";
  let pen = false;
  vals.forEach((v, i) => {
    if (v === null) return void (pen = false);
    path += `${pen ? "L" : "M"}${px(i).toFixed(1)},${py(v).toFixed(1)}`;
    pen = true;
  });
  let dots = "";
  vals.forEach((v, i) => {
    if (v !== null) dots += `<circle class="dot" cx="${px(i)}" cy="${py(v)}" r="4"/>`;
    const tip = `${shortDate(daily[i].day)}|${v === null ? "no answers" : `${v.toFixed(2)} fillers per answer`}`;
    dots += `<rect class="hit" x="${PAD_L + i * slot}" y="${PAD_T}" width="${slot}" height="${plotH}" data-tip="${esc(tip)}" tabindex="0"/>`;
  });
  const lab = [0, Math.floor(n / 2), n - 1].map((i) => ({ x: px(i), text: shortDate(daily[i].day) }));
  return svg(W, axes(W, maxY, lab, (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1))) + `<path class="line" d="${path}"/>` + dots, "Filler sounds per answer, per day");
}

function forecastChart(f: Stats["forecast"], W: number): string {
  const n = f.length;
  const slot = (W - PAD_L - PAD_R) / n;
  const bw = Math.min(24, slot - 6);
  const plotH = H - PAD_T - PAD_B;
  const maxY = niceMax(Math.max(1, ...f.map((d) => d.count)));
  let marks = "";
  f.forEach((d, i) => {
    const h = (d.count / maxY) * plotH;
    const x = PAD_L + i * slot + (slot - bw) / 2;
    marks += `<path class="s1" d="${col(x, PAD_T + plotH - h, bw, h, true)}"/>`;
    if (i === 0 && d.count) marks += `<text class="val" x="${x + bw / 2}" y="${PAD_T + plotH - h - 4}" text-anchor="middle">${d.count}</text>`;
    const tip = `${i === 0 ? "Today (incl. overdue)" : shortDate(d.day)}|${d.count} due`;
    marks += `<rect class="hit" x="${PAD_L + i * slot}" y="${PAD_T}" width="${slot}" height="${plotH}" data-tip="${esc(tip)}" tabindex="0"/>`;
  });
  const lab = [0, 7, n - 1].map((i) => ({ x: PAD_L + i * slot + slot / 2, text: i === 0 ? "Today" : shortDate(f[i].day) }));
  return svg(W, axes(W, maxY, lab) + marks, "Reviews due per day, next two weeks");
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** Heatmap step 0..4: 0 is empty, then four equal-width bins up to `max`. */
export function heatLevel(v: number, max: number): number {
  return v > 0 && max > 0 ? Math.min(4, Math.max(1, Math.ceil((4 * v) / max))) : 0;
}

/** The value range each heatmap step covers, for the scale legend. */
export function heatRanges(max: number): { level: number; text: string }[] {
  const out = [{ level: 0, text: "0" }];
  for (let k = 1; k <= 4; k++) {
    const lo = Math.floor(((k - 1) * max) / 4) + 1, hi = Math.floor((k * max) / 4);
    if (lo <= hi) out.push({ level: k, text: lo === hi ? String(lo) : `${lo}–${hi}` });
  }
  return out;
}

function heatLegend(max: number, unit: string): string {
  if (!max) return "";
  return `<ul class="legend">${heatRanges(max).map((r) => `<li><span class="sw h${r.level}"></span>${r.text}</li>`).join("")}<li>${esc(unit)}</li></ul>`;
}

/** GitHub-style calendar: one column per week, Monday on top, today last. */
function calendarChart(cal: Stats["calendar"], weeks: number, max: number, W: number): string {
  const days = cal.slice(7 * (CAL_WEEKS - weeks));
  const LBL = 30, TOP = 18;
  const step = Math.min(22, Math.floor((W - LBL) / weeks));
  const size = step - 3;
  let out = [0, 2, 4].map((r) => `<text class="tick" x="${LBL - 6}" y="${TOP + r * step + size / 2 + 4}" text-anchor="end">${WEEKDAYS[r]}</text>`).join("");
  let lastLabel = -9;
  days.forEach((d, i) => {
    const w = Math.floor(i / 7), r = i % 7;
    const x = LBL + w * step, y = TOP + r * step;
    // Month name over the first week that starts in it.
    if (r === 0 && (w === 0 || Number(d.day.slice(8)) <= 7) && w - lastLabel >= 3) {
      out += `<text class="tick" x="${x}" y="${TOP - 6}">${MONTHS[Number(d.day.slice(5, 7)) - 1]}</text>`;
      lastLabel = w;
    }
    const tip = `${WEEKDAYS[r]} ${shortDate(d.day)}|${d.answers ? `${d.answers} answers` : "No practice"}${d.answers ? `|${d.passed} passed` : ""}`;
    out += `<rect class="cell h${heatLevel(d.answers, max)}" x="${x}" y="${y}" width="${size}" height="${size}" rx="3" data-tip="${esc(tip)}"${d.answers ? ' tabindex="0"' : ""}/>`;
  });
  return svg(W, out, "Practice calendar, answers per day", TOP + 7 * step);
}

/** Weekday × hour heatmap; `bucket` hours per column (2 on phones). */
function hoursChart(hours: number[][], bucket: number, W: number): string {
  const cols = 24 / bucket;
  const grid = hours.map((row) => Array.from({ length: cols }, (_, c) => row.slice(c * bucket, (c + 1) * bucket).reduce((a, b) => a + b, 0)));
  const max = Math.max(0, ...grid.flat());
  const LBL = 36, BOT = 20;
  const step = Math.min(26, Math.floor((W - LBL) / cols));
  const size = step - 3;
  let out = "";
  grid.forEach((row, r) => {
    out += `<text class="tick" x="${LBL - 6}" y="${r * step + size / 2 + 4}" text-anchor="end">${WEEKDAYS[r]}</text>`;
    row.forEach((n, c) => {
      const tip = `${WEEKDAYS[r]} ${hh(c * bucket)}–${hh((c + 1) * bucket)}|${n} answers`;
      out += `<rect class="cell h${heatLevel(n, max)}" x="${LBL + c * step}" y="${r * step}" width="${size}" height="${size}" rx="3" data-tip="${esc(tip)}"${n ? ' tabindex="0"' : ""}/>`;
    });
  });
  for (const h of [0, 6, 12, 18]) out += `<text class="tick" x="${LBL + (h / bucket) * step}" y="${7 * step + BOT - 6}" text-anchor="middle">${hh(h)}</text>`;
  return svg(W, out, "Answers by weekday and hour", 7 * step + BOT) + heatLegend(max, bucket === 1 ? "answers per hour" : `answers per ${bucket} hours`);
}

/** Pass rate per gap bucket; buckets with few answers are faded, not hidden. */
function memoryChart(gaps: Stats["gaps"], W: number): string {
  const n = gaps.length;
  const slot = (W - PAD_L - PAD_R) / n;
  const bw = Math.min(24, slot - 8);
  const plotH = H - PAD_T - PAD_B;
  let marks = "";
  gaps.forEach((g, i) => {
    const x = PAD_L + i * slot + (slot - bw) / 2;
    const rate = g.answers ? g.passed / g.answers : null;
    if (rate !== null) {
      const h = rate * plotH;
      marks += `<path class="s1${g.answers < FEW ? " faint" : ""}" d="${col(x, PAD_T + plotH - h, bw, h, true)}"/>`;
      marks += `<text class="val" x="${x + bw / 2}" y="${PAD_T + plotH - h - 4}" text-anchor="middle">${pct(rate)}</text>`;
    }
    const tip = `${g.label} since the previous answer|${rate === null ? "No answers" : `${pct(rate)} passed`}|${g.answers} answers${g.answers && g.answers < FEW ? " (too few to judge)" : ""}`;
    marks += `<rect class="hit" x="${PAD_L + i * slot}" y="${PAD_T}" width="${slot}" height="${plotH}" data-tip="${esc(tip)}" tabindex="0"/>`;
  });
  const lab = gaps.map((g, i) => ({ x: PAD_L + i * slot + slot / 2, text: g.short }));
  return svg(W, axes(W, 100, lab, (v) => `${v}%`) + marks, "Pass rate by days since the previous answer");
}
const FEW = 5;

function growthChart(g: Stats["growth"], W: number): string {
  const n = g.length;
  const slot = (W - PAD_L - PAD_R) / n;
  const plotH = H - PAD_T - PAD_B;
  const maxY = niceMax(Math.max(1, ...g.map((d) => d.total)));
  const px = (i: number) => PAD_L + i * slot + slot / 2;
  const py = (v: number) => PAD_T + plotH - (v / maxY) * plotH;
  const line = g.map((d, i) => `${i ? "L" : "M"}${px(i).toFixed(1)},${py(d.total).toFixed(1)}`).join("");
  const area = `${line}L${px(n - 1).toFixed(1)},${PAD_T + plotH}L${px(0).toFixed(1)},${PAD_T + plotH}Z`;
  const last = g[n - 1];
  let marks = `<path class="area" d="${area}"/><path class="line" d="${line}"/>`;
  marks += `<circle class="dot" cx="${px(n - 1)}" cy="${py(last.total)}" r="4"/>`;
  marks += `<text class="val" x="${px(n - 1) - 8}" y="${py(last.total) - 8}" text-anchor="end">${last.total}</text>`;
  g.forEach((d, i) => {
    const tip = `${shortDate(d.day)}|${d.total} words${d.added ? `|+${d.added} new` : ""}`;
    marks += `<rect class="hit" x="${PAD_L + i * slot}" y="${PAD_T}" width="${slot}" height="${plotH}" data-tip="${esc(tip)}"${d.added ? ' tabindex="0"' : ""}/>`;
  });
  const lab = [0, Math.floor(n / 2), n - 1].map((i) => ({ x: px(i), text: shortDate(g[i].day) }));
  return svg(W, axes(W, maxY, lab) + marks, "Words in your list over time");
}

const GRADE_LABELS = ["No answer or English", "Wrong word or form", "Only after a hint", "Correct, 3+ fillers", "Correct, 1–2 fillers", "Correct and fluent"];

/** Horizontal bars, grade 5 on top; values are printed, so no tooltip needed. */
function gradeBars(grades: number[]): string {
  const total = grades.reduce((a, b) => a + b, 0);
  if (!total) return `<p class="muted">No answers in the last ${DAYS} days.</p>`;
  const max = Math.max(...grades);
  const rows = [5, 4, 3, 2, 1, 0].map((g) => {
    const n = grades[g];
    const bar = n ? `<span class="hbar ${g >= 3 ? "s1" : "s2"}" style="width:${((n / max) * 100).toFixed(1)}%"></span>` : "";
    return `<span class="hl"><b>${g}</b>${esc(GRADE_LABELS[g])}</span><span class="track">${bar}</span><span class="hv">${n} · ${pct(n / total)}</span>`;
  });
  return `<div class="hbars">${rows.join("")}</div>`;
}

function svg(W: number, body: string, label: string, h = H): string {
  return `<svg viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(label)}">${body}</svg>`;
}

function both(chart: (W: number) => string): string {
  return `<div class="wide">${chart(WIDE)}</div><div class="narrow">${chart(NARROW)}</div>`;
}

function stagesBar(stages: Stats["stages"]): string {
  const total = stages.reduce((a, s) => a + s.count, 0);
  if (!total) return `<p class="muted">No words yet.</p>`;
  const segs = stages
    .map((s, i) => (s.count ? `<div class="seg st${i}" style="flex:${s.count}" data-tip="${esc(`${s.label}|${s.count} words`)}" tabindex="0"></div>` : ""))
    .join("");
  const legend = stages
    .map((s, i) => `<li><span class="sw st${i}"></span>${esc(s.label)} <b>${s.count}</b></li>`)
    .join("");
  return `<div class="stack">${segs}</div><ul class="legend">${legend}</ul>`;
}

/** `smHide`: column indexes hidden on phones. */
function table(head: string[], rows: (string | number)[][], cls = "", smHide: number[] = []): string {
  const c = (i: number) => (smHide.includes(i) ? ' class="sm-hide"' : "");
  return `<table class="${cls}"><thead><tr>${head.map((h, i) => `<th${c(i)}>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((v, i) => `<td${c(i)}>${esc(v)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

function tile(label: string, value: string, sub = ""): string {
  return `<div class="tile"><div class="tl">${esc(label)}</div><div class="tv">${esc(value)}</div>${sub ? `<div class="ts">${sub}</div>` : ""}</div>`;
}

export function renderStats(s: Stats, token: string, openCase: CaseFile | null = null): string {
  const learned = s.stages[2].count + s.stages[3].count;
  const fillerDelta =
    s.week.fillers !== null && s.week.prevFillers !== null
      ? (() => {
          const d = s.week.fillers - s.week.prevFillers;
          const good = d <= 0;
          return `<span class="${good ? "good" : "bad"}">${good ? "▼" : "▲"} ${Math.abs(d).toFixed(1)}</span> vs previous week`;
        })()
      : "per answer, last 7 days";
  const daysWithAnswers = s.daily.filter((d) => d.passed + d.failed);
  const calMax = Math.max(0, ...s.calendar.map((d) => d.answers));
  const calActive = s.calendar.filter((d) => d.answers).length;
  const calWeeks = Array.from({ length: Math.ceil(s.calendar.length / 7) }, (_, w) => s.calendar.slice(w * 7, w * 7 + 7))
    .map((wk) => [wk[0].day, wk.filter((d) => d.answers).length, wk.reduce((a, d) => a + d.answers, 0)])
    .filter((r) => r[2])
    .reverse();
  const slots = s.hours
    .flatMap((row, d) => row.map((n, h) => ({ d, h, n })))
    .filter((x) => x.n)
    .sort((a, b) => b.n - a.n);
  const slotName = (x: { d: number; h: number }) => `${WEEKDAYS[x.d]} ${hh(x.h)}–${hh(x.h + 1)}`;
  const gradeTotal = s.grades.reduce((a, b) => a + b, 0);
  const firstTry = s.gaps.reduce((a, g) => a + g.answers, 0);
  const growthAdded = s.growth.reduce((a, d) => a + d.added, 0);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Italian progress</title>
<style>
${PAGE_CSS}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:16px 0}
.tile,.card{background:var(--surface);border:1px solid var(--ring);border-radius:12px;padding:14px}
.tl{font-size:13px;color:var(--ink2)}.tv{font-size:28px;font-weight:600;margin-top:2px}.ts{font-size:12px;color:var(--ink2)}
.good{color:var(--good)}.bad{color:var(--bad)}
.card{margin-top:12px}
svg{display:block;width:100%;height:auto;overflow:visible}
.grid{stroke:var(--grid);stroke-width:1}.base{stroke:var(--base);stroke-width:1}
.tick{fill:var(--muted);font-size:11px;font-variant-numeric:tabular-nums}.val{fill:var(--ink2);font-size:11px}
.s1{fill:var(--s1)}.s2{fill:var(--s2)}
.line{fill:none;stroke:var(--s1);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.dot{fill:var(--s1);stroke:var(--surface);stroke-width:2}
.hit{fill:transparent;cursor:default;outline:none}.hit:hover,.hit:focus{fill:var(--ink);fill-opacity:.05}
.legend{display:flex;flex-wrap:wrap;gap:4px 16px;list-style:none;padding:0;margin:8px 0 0;font-size:13px;color:var(--ink2)}
.sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px}
.sw.s1{background:var(--s1)}.sw.s2{background:var(--s2)}
.stack{display:flex;gap:2px;height:20px;margin-top:8px}.seg{border-radius:0}.seg:first-child{border-radius:4px 0 0 4px}.seg:last-child{border-radius:0 4px 4px 0}.seg:only-child{border-radius:4px}
.st0{background:var(--st0)}.st1{background:var(--st1)}.st2{background:var(--st2)}.st3{background:var(--st3)}
details{margin-top:8px;font-size:13px}summary{cursor:pointer;color:var(--ink2)}
.scroll{overflow-x:auto}
.cell{stroke:var(--ink);stroke-width:0;outline:none}.cell:hover,.cell:focus{stroke-width:1.5}
.h0{fill:var(--h0);background:var(--h0)}.h1{fill:var(--h1);background:var(--h1)}.h2{fill:var(--h2);background:var(--h2)}.h3{fill:var(--h3);background:var(--h3)}.h4{fill:var(--h4);background:var(--h4)}
.faint{fill-opacity:.4}
.area{fill:var(--s1);fill-opacity:.1}
.hbars{display:grid;grid-template-columns:auto 1fr auto;gap:8px 12px;align-items:center;font-size:13px;margin-top:4px}
.hl{color:var(--ink2)}.hl b{display:inline-block;width:1.2em;color:var(--ink)}
.track{height:14px;display:flex}.hbar{display:block;height:100%;border-radius:0 4px 4px 0;min-width:2px}.hbar.s1{background:var(--s1)}.hbar.s2{background:var(--s2)}
.hv{text-align:right;font-variant-numeric:tabular-nums;color:var(--ink2)}
${CASE_CARD_CSS}
.narrow{display:none}
@media (max-width:600px){.wide{display:none}.narrow{display:block}.sm-hide{display:none}}
${TIP_CSS}
</style></head><body><main>
${nav(token, "stats")}
<h1>Italian progress</h1>
<p class="sub">As of ${esc(shortDate(s.today))} · ${s.totals.items} words · ${s.totals.attempts} answers graded in total</p>

<div class="tiles">
${tile("Due today", String(s.totals.due), s.totals.due ? `including overdue · <a href="/drill/${esc(encodeURIComponent(token))}">drill now</a>` : "including overdue")}
${tile("Practice streak", `${s.streak} ${s.streak === 1 ? "day" : "days"}`, `${s.totals.activeDays} days practised in total`)}
${tile("Pass rate", pct(s.week.passRate), `${s.week.attempts} answers, last 7 days`)}
${tile("Fillers", num1(s.week.fillers), fillerDelta)}
${tile("Learned", String(learned), "interval of a week or more")}
</div>

${caseCard(openCase, token)}

<section class="card"><h2>Practice calendar</h2><p class="sub">Answers per day, one square per day, newest week on the right. ${calActive} ${calActive === 1 ? "day" : "days"} practised in the last ${CAL_WEEKS} weeks.</p>
<div class="wide">${calendarChart(s.calendar, CAL_WEEKS, calMax, WIDE)}</div><div class="narrow">${calendarChart(s.calendar, CAL_WEEKS_NARROW, calMax, NARROW)}</div>
${heatLegend(calMax, "answers")}
<details><summary>Table</summary><div class="scroll">${table(["Week of", "Days practised", "Answers"], calWeeks)}</div></details>
</section>

<section class="card"><h2>Answers per day</h2><p class="sub">Last ${s.daily.length} days. Passed = grade 3 or higher.</p>
<ul class="legend"><li><span class="sw s1"></span>Passed</li><li><span class="sw s2"></span>Failed</li></ul>
${both((W) => answersChart(s.daily, W))}
<details><summary>Table</summary><div class="scroll">${table(["Day", "Passed", "Failed"], daysWithAnswers.map((d) => [d.day, d.passed, d.failed]))}</div></details>
</section>

<section class="card"><h2>Hesitation</h2><p class="sub">Average filler sounds (eh, ehm, uh…) per spoken answer. Lower is better; days without spoken answers are gaps.</p>
${both((W) => fillersChart(s.daily, W))}
<details><summary>Table</summary><div class="scroll">${table(["Day", "Fillers per answer"], daysWithAnswers.map((d) => [d.day, d.fillers ?? "–"]))}</div></details>
</section>

<section class="card"><h2>How answers were graded</h2><p class="sub">Last ${DAYS} days, ${gradeTotal} answers. Grades 3–5 pass, 0–2 fail.</p>
<ul class="legend"><li><span class="sw s1"></span>Passed</li><li><span class="sw s2"></span>Failed</li></ul>
${gradeBars(s.grades)}
</section>

<section class="card"><h2>How well words stick</h2><p class="sub">Pass rate by days since the same word was last answered${firstTry ? `, ${firstTry} answers` : ""}. A word's first answer isn't counted; faded columns have fewer than ${FEW} answers.</p>
${firstTry ? `${both((W) => memoryChart(s.gaps, W))}
<details><summary>Table</summary><div class="scroll">${table(["Days since previous answer", "Answers", "Passed", "Pass rate"], s.gaps.map((g) => [g.label, g.answers, g.passed, g.answers ? pct(g.passed / g.answers) : "–"]))}</div></details>` : `<p class="muted">Needs words answered at least twice.</p>`}
</section>

<section class="card"><h2>When you practise</h2><p class="sub">Answers by weekday and hour in your time zone, last ${HOUR_DAYS} days.${slots.length ? ` Busiest: ${esc(slotName(slots[0]))}.` : ""}</p>
${slots.length ? `${both((W) => hoursChart(s.hours, W === WIDE ? 1 : 2, W))}
<details><summary>Table</summary><div class="scroll">${table(["Time", "Answers"], slots.slice(0, 10).map((x) => [slotName(x), x.n]))}</div></details>` : `<p class="muted">No answers yet.</p>`}
</section>

<section class="card"><h2>Where your words are</h2><p class="sub">By current review interval.</p>
${stagesBar(s.stages)}
</section>

<section class="card"><h2>Vocabulary growth</h2><p class="sub">Words in your list at the end of each day, last ${GROWTH_DAYS} days: ${growthAdded} added.</p>
${both((W) => growthChart(s.growth, W))}
<details><summary>Table</summary><div class="scroll">${table(["Day", "Added", "Total"], s.growth.filter((d) => d.added).reverse().map((d) => [d.day, d.added, d.total]))}</div></details>
</section>

<section class="card"><h2>Coming up</h2><p class="sub">Reviews due per day, next two weeks. Today includes anything overdue.</p>
${both((W) => forecastChart(s.forecast, W))}
<details><summary>Table</summary><div class="scroll">${table(["Day", "Due"], s.forecast.map((d) => [d.day, d.count]))}</div></details>
</section>

<section class="card"><h2>Hardest words</h2><p class="sub">Most failed answers, then lowest ease. <a href="/poster/${esc(encodeURIComponent(token))}">Print them as a poster</a></p>
${s.hardest.length ? `<div class="scroll">${table(["Italian", "English", "Fails", "Answers", "Ease", "Last"], s.hardest.map((h) => [h.italian, h.english, h.fails, h.attempts, h.ease.toFixed(2), h.last]), "words", [3, 4, 5])}</div>` : `<p class="muted">No failed answers yet.</p>`}
</section>

<section class="card"><h2>Recently captured</h2><p class="sub">${Object.entries(s.sources).map(([k, v]) => `${esc(k)} ${v}`).join(" · ") || "Nothing yet."}</p>
${s.recent.length ? `<div class="scroll">${table(["Italian", "English", "Note", "Example", "Context", "Source", "Captured"], s.recent.map((r) => [r.italian, r.english, r.note ?? "", r.example ?? "", r.context ?? "", r.source, r.captured]), "words", [2, 5, 6])}</div>` : ""}
</section>
</main>
${TIP_HTML}
</body></html>`;
}

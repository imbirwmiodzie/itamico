// Learning stats: the queries behind GET /stats/<token> and the page itself.
// Server-rendered HTML with inline SVG charts, no external assets: one request,
// works on a phone, nothing to install.

import type { Db } from "./db.js";
import { today } from "./db.js";
import { esc, nav, PAGE_CSS } from "./page.js";

export interface Stats {
  today: string;
  totals: { items: number; due: number; attempts: number; activeDays: number };
  stages: { label: string; count: number }[];
  week: { attempts: number; passRate: number | null; fillers: number | null; prevFillers: number | null };
  streak: number;
  daily: { day: string; passed: number; failed: number; fillers: number | null }[];
  forecast: { day: string; count: number }[];
  hardest: { italian: string; english: string; ease: number; attempts: number; fails: number; last: string }[];
  recent: { italian: string; english: string; note: string | null; context: string | null; source: string; captured: string }[];
  sources: Record<string, number>;
}

const DAYS = 30;
const FORECAST_DAYS = 14;

export async function loadStats(db: Db, timeZone: string): Promise<Stats> {
  const day = today(timeZone);
  // A timestamp as a calendar day in the user's zone; tz is query parameter $p.
  const local = (col: string, p = 2) => `(${col} at time zone $${p})::date`;

  const [totals, stages, daily, week, active, forecast, hardest, recent, sources] = await Promise.all([
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
              round(avg(a.fillers)::numeric, 2)::float as fillers
         from days left join attempts a on ${local("a.at")} = d
        group by d order by d`,
      [day, timeZone],
    ),
    db.query(
      `select count(*) filter (where ${local("at")} > $1::date - 7)::int as attempts,
              avg((grade >= 3)::int) filter (where ${local("at")} > $1::date - 7)::float as pass_rate,
              avg(fillers) filter (where ${local("at")} > $1::date - 7)::float as fillers,
              avg(fillers) filter (where ${local("at")} <= $1::date - 7 and ${local("at")} > $1::date - 14)::float as prev_fillers
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
      `select italian, english, note, context, source, to_char(${local("last_captured_at", 1)}, 'YYYY-MM-DD') as captured
         from items order by last_captured_at desc, id desc limit 15`,
      [timeZone],
    ),
    db.query(`select source, count(*)::int as n from items group by source`),
  ]);

  const activeDays: string[] = active.rows.map((r) => r.day);
  const byDay = new Map(forecast.rows.map((r) => [r.day as string, r.count as number]));
  const s = stages.rows[0];
  const w = week.rows[0];

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

function addDays(day: string, n: number): string {
  const t = new Date(`${day}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ rendering

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
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

function svg(W: number, body: string, label: string): string {
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${body}</svg>`;
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

export function renderStats(s: Stats, token: string): string {
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
.narrow{display:none}
@media (max-width:600px){.wide{display:none}.narrow{display:block}.sm-hide{display:none}}
#tip{position:fixed;pointer-events:none;background:var(--surface);color:var(--ink);border:1px solid var(--ring);border-radius:8px;padding:6px 10px;font-size:12px;box-shadow:0 4px 16px rgba(0,0,0,.12);display:none;z-index:9}
#tip b{display:block;font-size:13px}
</style></head><body><main>
${nav(token, "stats")}
<h1>Italian progress</h1>
<p class="sub">As of ${esc(shortDate(s.today))} · ${s.totals.items} words · ${s.totals.attempts} answers graded in total</p>

<div class="tiles">
${tile("Due today", String(s.totals.due), "including overdue")}
${tile("Practice streak", `${s.streak} ${s.streak === 1 ? "day" : "days"}`, `${s.totals.activeDays} days practised in total`)}
${tile("Pass rate", pct(s.week.passRate), `${s.week.attempts} answers, last 7 days`)}
${tile("Fillers", num1(s.week.fillers), fillerDelta)}
${tile("Learned", String(learned), "interval of a week or more")}
</div>

<section class="card"><h2>Answers per day</h2><p class="sub">Last ${s.daily.length} days. Passed = grade 3 or higher.</p>
<ul class="legend"><li><span class="sw s1"></span>Passed</li><li><span class="sw s2"></span>Failed</li></ul>
${both((W) => answersChart(s.daily, W))}
<details><summary>Table</summary><div class="scroll">${table(["Day", "Passed", "Failed"], daysWithAnswers.map((d) => [d.day, d.passed, d.failed]))}</div></details>
</section>

<section class="card"><h2>Hesitation</h2><p class="sub">Average filler sounds (eh, ehm, uh…) per answer. Lower is better; days without answers are gaps.</p>
${both((W) => fillersChart(s.daily, W))}
<details><summary>Table</summary><div class="scroll">${table(["Day", "Fillers per answer"], daysWithAnswers.map((d) => [d.day, d.fillers ?? "–"]))}</div></details>
</section>

<section class="card"><h2>Where your words are</h2><p class="sub">By current review interval.</p>
${stagesBar(s.stages)}
</section>

<section class="card"><h2>Coming up</h2><p class="sub">Reviews due per day, next two weeks. Today includes anything overdue.</p>
${both((W) => forecastChart(s.forecast, W))}
<details><summary>Table</summary><div class="scroll">${table(["Day", "Due"], s.forecast.map((d) => [d.day, d.count]))}</div></details>
</section>

<section class="card"><h2>Hardest words</h2><p class="sub">Most failed answers, then lowest ease.</p>
${s.hardest.length ? `<div class="scroll">${table(["Italian", "English", "Fails", "Answers", "Ease", "Last"], s.hardest.map((h) => [h.italian, h.english, h.fails, h.attempts, h.ease.toFixed(2), h.last]), "words", [3, 4, 5])}</div>` : `<p class="muted">No failed answers yet.</p>`}
</section>

<section class="card"><h2>Recently captured</h2><p class="sub">${Object.entries(s.sources).map(([k, v]) => `${esc(k)} ${v}`).join(" · ") || "Nothing yet."}</p>
${s.recent.length ? `<div class="scroll">${table(["Italian", "English", "Note", "Context", "Source", "Captured"], s.recent.map((r) => [r.italian, r.english, r.note ?? "", r.context ?? "", r.source, r.captured]), "words", [2, 4, 5])}</div>` : ""}
</section>
</main>
<div id="tip" role="status"></div>
<script>
(() => {
  const tip = document.getElementById("tip");
  const show = (el, x, y) => {
    const [head, ...rest] = el.dataset.tip.split("|");
    tip.replaceChildren();
    const b = document.createElement("b"); b.textContent = rest.length ? rest[0] : head; tip.append(b);
    for (const line of rest.length ? [head, ...rest.slice(1)] : []) { const d = document.createElement("div"); d.textContent = line; tip.append(d); }
    tip.style.display = "block";
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.min(window.innerWidth - r.width - 8, Math.max(8, x + 12)) + "px";
    tip.style.top = Math.max(8, y - r.height - 12) + "px";
  };
  const hide = () => { tip.style.display = "none"; };
  document.querySelectorAll("[data-tip]").forEach((el) => {
    el.addEventListener("pointermove", (e) => show(el, e.clientX, e.clientY));
    el.addEventListener("pointerleave", hide);
    el.addEventListener("focus", () => { const r = el.getBoundingClientRect(); show(el, r.left + r.width / 2, r.top); });
    el.addEventListener("blur", hide);
  });
})();
</script>
</body></html>`;
}

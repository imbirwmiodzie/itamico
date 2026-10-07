// The word atlas: the dictionary itself drawn four ways at /atlas/<token>, plus a
// full-screen ambient screensaver at /ambient/<token>. Where the stats page
// charts practice, these show the words:
//   - Cielo (sky): every word a star; the closer to the sun, the shorter it stays
//     in memory. Words sharing a note (masculine, plural…) form constellations.
//   - Giardino (garden): every word a plant that grows with its review interval,
//     from seed to olive tree, and wilts when it's overdue.
//   - Nuvola (cloud): the words sized by how much trouble they give.
//   - Errori (mistakes): what you said next to the right word, letter by letter.
// Server-rendered inline SVG, no external assets, light and dark mode.

import type { Db } from "./db.js";
import { today } from "./db.js";
import { esc, nav, PAGE_CSS, TIP_CSS, TIP_HTML } from "./page.js";
import { markWord } from "./poster.js";
import { shortDate } from "./stats.js";
import { foldText } from "./store.js";

export interface AtlasWord {
  id: number;
  italian: string;
  english: string;
  note: string | null;
  context: string | null;
  example: string | null;
  ease: number;
  interval: number;
  reps: number;
  /** Days past its due date, 0 when not overdue. */
  overdue: number;
  due: boolean;
  created: string;
  attempts: number;
  lapses: number;
  pic: number | null;
}

export interface Mistake {
  id: number;
  italian: string;
  english: string;
  /** How many times it was answered wrongly. */
  count: number;
  /** The latest wrong answers, newest first (at most 3). */
  wrong: { answer: string; day: string }[];
}

export interface Atlas {
  today: string;
  words: AtlasWord[];
  mistakes: Mistake[];
}

export type AtlasView = "sky" | "garden" | "cloud" | "mistakes";
export const VIEWS: AtlasView[] = ["sky", "garden", "cloud", "mistakes"];

const MAX_WORDS = 2000;
const MAX_MISTAKES = 40;

export async function loadAtlas(db: Db, timeZone: string): Promise<Atlas> {
  const day = today(timeZone);
  const [words, mistakes] = await Promise.all([
    db.query(
      `select i.id::int as id, i.italian, i.english, i.note, i.context, i.example, round(i.ease::numeric, 2)::float as ease,
              i.interval_days as interval, i.repetitions as reps,
              greatest(0, $1::date - i.due_on)::int as overdue, (i.due_on <= $1::date) as due,
              to_char(i.created_at at time zone $2, 'YYYY-MM-DD') as created,
              count(a.id)::int as attempts, count(a.id) filter (where a.grade < 3)::int as lapses,
              floor(extract(epoch from p.fetched_at))::float8 as pic
         from items i left join attempts a on a.item_id = i.id left join pictures p on p.item_id = i.id
        group by i.id, p.item_id
        order by i.created_at, i.id
        limit ${MAX_WORDS}`,
      [day, timeZone],
    ),
    // Wrong answers that were actually said or typed, and differ from the word.
    db.query(
      `select i.id::int as id, i.italian, i.english, count(*)::int as count,
              json_agg(json_build_object('answer', btrim(a.answer), 'day', to_char(a.at at time zone $1, 'YYYY-MM-DD'))
                       order by a.at desc) as wrong
         from attempts a join items i on i.id = a.item_id
        where a.grade < 3 and btrim(coalesce(a.answer, '')) <> '' and lower(btrim(a.answer)) <> lower(btrim(i.italian))
        group by i.id
        order by count(*) desc, max(a.at) desc
        limit ${MAX_MISTAKES}`,
      [timeZone],
    ),
  ]);
  return {
    today: day,
    words: words.rows,
    mistakes: mistakes.rows.map((m) => ({ ...m, wrong: (m.wrong as Mistake["wrong"]).slice(0, 3) })),
  };
}

// ------------------------------------------------------------------ stages

/** Growth stage 0..5 by review interval; 0 = not recalled yet (or just failed). */
export function stage(w: Pick<AtlasWord, "reps" | "interval">): number {
  if (w.reps === 0) return 0;
  if (w.interval <= 1) return 1;
  if (w.interval < 7) return 2;
  if (w.interval < 21) return 3;
  if (w.interval < 90) return 4;
  return 5;
}

export const STAGES = [
  { it: "Seme", en: "Seed", span: "not recalled yet" },
  { it: "Germoglio", en: "Sprout", span: "kept 1 day" },
  { it: "Piantina", en: "Seedling", span: "kept 2–6 days" },
  { it: "Bocciolo", en: "Bud", span: "kept 1–3 weeks" },
  { it: "Fiore", en: "Flower", span: "kept 3 weeks to 3 months" },
  { it: "Ulivo", en: "Olive tree", span: "kept 3 months or more" },
];

/** Overdue this many days or more, a plant wilts. */
export const WILT_DAYS = 3;

/** How much trouble a word gives: every lapse, plus 2 per point of ease lost. */
export const trouble = (w: Pick<AtlasWord, "lapses" | "ease">) => w.lapses + 2 * Math.max(0, 2.5 - w.ease);

/** A small stable hash, for placement and colour that don't change between visits. */
export function hash(n: number): number {
  let h = (n ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

function tipOf(w: AtlasWord): string {
  const s = STAGES[stage(w)];
  const kept = w.reps === 0 ? "not recalled yet" : `next review in ${days(w.interval)}`;
  const lines = [`${s.it} · ${kept}`];
  if (w.attempts) lines.push(w.lapses ? `forgotten ${times(w.lapses)} in ${w.attempts} answers` : `${w.attempts} answers, never forgotten`);
  if (w.overdue) lines.push(`${days(w.overdue)} overdue`);
  else if (w.due) lines.push("due today");
  return [w.english, w.italian, ...lines].join("|");
}

// ------------------------------------------------------------------- sky

const SKY = 720, MID = SKY / 2, SUN = 22, INNER = 52, OUTER = 300, MAX_IV = 180;
/** Extra room left and right of the sky for constellation names. */
const SIDE = 110;
const ORBITS = [
  { d: 1, label: "1 day" },
  { d: 7, label: "1 week" },
  { d: 30, label: "1 month" },
  { d: 90, label: "3 months" },
];

const orbitR = (interval: number) => INNER + 16 + (OUTER - INNER - 16) * Math.min(1, Math.log1p(interval) / Math.log1p(MAX_IV));

/** Notes shared by two words or more become constellations; lower-cased, trimmed. */
export function constellations(words: AtlasWord[]): Map<string, AtlasWord[]> {
  const by = new Map<string, AtlasWord[]>();
  for (const w of words) {
    const k = (w.note ?? "").trim().toLowerCase();
    if (k) by.set(k, [...(by.get(k) ?? []), w]);
  }
  return new Map([...by].filter(([, ws]) => ws.length > 1).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])));
}

interface Placed { w: AtlasWord; x: number; y: number; a: number; r: number }

/**
 * Positions: each word gets an equal slice of the circle, a constellation's
 * words side by side with a gap around it; the distance from the sun is the
 * review interval on a log scale, so new and lapsed words crowd near the sun.
 */
export function placeStars(words: AtlasWord[]): { stars: Placed[]; groups: [string, Placed[]][] } {
  const groups = constellations(words);
  const inGroup = new Set([...groups.values()].flat().map((w) => w.id));
  const loose = words.filter((w) => !inGroup.has(w.id));
  const order: (AtlasWord | null)[] = [];
  for (const ws of groups.values()) order.push(...ws, null);
  order.push(...loose);
  const slot = (2 * Math.PI) / Math.max(1, order.length);
  const stars: Placed[] = [];
  const byId = new Map<number, Placed>();
  order.forEach((w, i) => {
    if (!w) return;
    const j = hash(w.id);
    const a = -Math.PI / 2 + (i + 0.5) * slot + (j - 0.5) * slot * 0.5;
    const r = w.reps === 0 ? SUN + 14 + j * (INNER - SUN - 4) : orbitR(w.interval) + (hash(w.id + 7) - 0.5) * 14;
    const p = { w, a, r, x: MID + r * Math.cos(a), y: MID + r * Math.sin(a) };
    stars.push(p);
    byId.set(w.id, p);
  });
  return { stars, groups: [...groups].map(([k, ws]) => [k, ws.map((w) => byId.get(w.id)!)]) };
}

const f1 = (n: number) => n.toFixed(1);

function skyView(a: Atlas): string {
  if (!a.words.length) return empty();
  const { stars, groups } = placeStars(a.words);
  // Faint background stars, the same on every visit.
  let dust = "";
  for (let i = 0; i < 180; i++) {
    dust += `<circle cx="${f1(hash(i * 3 + 1) * (SKY + 2 * SIDE) - SIDE)}" cy="${f1(hash(i * 3 + 2) * SKY)}" r="${f1(0.4 + hash(i * 3 + 3) * 0.9)}"/>`;
  }
  let orbits = "";
  for (const o of ORBITS) {
    const r = orbitR(o.d);
    orbits += `<circle class="orbit" cx="${MID}" cy="${MID}" r="${f1(r)}"/><text class="olbl" x="${MID}" y="${f1(MID - r - 4)}">${o.label}</text>`;
  }
  let lines = "", names = "";
  for (const [note, ps] of groups) {
    lines += `<polyline class="cline" points="${ps.map((p) => `${f1(p.x)},${f1(p.y)}`).join(" ")}"/>`;
    const mean = Math.atan2(ps.reduce((s, p) => s + Math.sin(p.a), 0), ps.reduce((s, p) => s + Math.cos(p.a), 0));
    const R = OUTER + 26, x = MID + R * Math.cos(mean), y = MID + R * Math.sin(mean);
    const anchor = Math.abs(Math.cos(mean)) < 0.3 ? "middle" : Math.cos(mean) > 0 ? "start" : "end";
    const label = note.length > 22 ? `${note.slice(0, 21)}…` : note;
    names += `<text class="cname" x="${f1(x)}" y="${f1(y + 4)}" text-anchor="${anchor}">${esc(label)}</text>`;
  }
  // Name the most troublesome stars, right of the star or else left of it,
  // skipping a name that would overlap one already placed.
  const size = (w: AtlasWord) => 2.2 + Math.min(4.5, Math.sqrt(w.attempts) * 0.9);
  const short = (t: string) => (t.length > 24 ? `${t.slice(0, 23)}…` : t);
  const boxes: [number, number, number, number][] = [];
  const labels = new Map<number, string>();
  for (const p of [...stars].sort((x, y) => trouble(y.w) - trouble(x.w) || x.w.id - y.w.id).slice(0, 24)) {
    const width = short(p.w.italian).length * 6.2, gap = size(p.w) + 4;
    for (const side of [1, -1]) {
      const x0 = side > 0 ? p.x + gap : p.x - gap - width, box: [number, number, number, number] = [x0, p.y - 8, x0 + width, p.y + 6];
      if (boxes.some((b) => box[0] < b[2] && b[0] < box[2] && box[1] < b[3] && b[1] < box[3])) continue;
      boxes.push(box);
      labels.set(p.w.id, `<text class="slbl" x="${f1(side * gap)}" y="4"${side < 0 ? ' text-anchor="end"' : ""}>${esc(short(p.w.italian))}</text>`);
      break;
    }
  }
  let marks = "";
  for (const p of stars) {
    const w = p.w, s = stage(w);
    const delay = (hash(w.id + 3) * 3).toFixed(2);
    const label = labels.get(w.id) ?? "";
    marks += `<g class="star k${s}${w.due ? " due" : ""}" transform="translate(${f1(p.x)} ${f1(p.y)})" data-tip="${esc(tipOf(w))}" tabindex="0" style="--d:${delay}s">`
      + `<circle class="halo" r="${f1(size(w) * 2.6)}"/><circle class="core" r="${f1(size(w))}"/>${label}</g>`;
  }
  const nearSun = a.words.filter((w) => w.reps === 0).length;
  const due = a.words.filter((w) => w.due).length;
  const closest = [...stars].sort((x, y) => x.r - y.r || trouble(y.w) - trouble(x.w)).slice(0, 8);
  return `<section class="card sky"><h2>Il cielo delle parole</h2>
<p class="sub">Every word is a star. The closer to the sun, the sooner it slips away: new and just-forgotten words burn close in, the ones you keep for months drift to the outer orbits. ${nearSun ? `${nearSun} ${nearSun === 1 ? "word is" : "words are"} still by the sun. ` : ""}${due ? `${due} twinkling ${due === 1 ? "star is" : "stars are"} due today.` : "Nothing is due today."}</p>
<svg viewBox="${-SIDE} 0 ${SKY + 2 * SIDE} ${SKY}" class="skysvg" role="img" aria-label="Star map of ${a.words.length} words">
<defs><radialGradient id="night" cx="50%" cy="50%" r="70%"><stop offset="0" stop-color="#1b2552"/><stop offset=".6" stop-color="#0d1330"/><stop offset="1" stop-color="#060914"/></radialGradient>
<radialGradient id="sun"><stop offset="0" stop-color="#fff6c8"/><stop offset=".45" stop-color="#ffd25e"/><stop offset="1" stop-color="#ff9d2e" stop-opacity="0"/></radialGradient></defs>
<rect x="${-SIDE}" width="${SKY + 2 * SIDE}" height="${SKY}" rx="18" fill="url(#night)"/>
<g class="dust">${dust}</g>
${orbits}
<circle cx="${MID}" cy="${MID}" r="${SUN * 2.6}" fill="url(#sun)" opacity=".55"/><circle cx="${MID}" cy="${MID}" r="${SUN * 0.75}" fill="#ffe28a"/>
${lines}${names}${marks}
</svg>
<h3 class="closest">Closest to the sun</h3>
<ol class="closest">${closest.map((p) => `<li><span class="dot k${stage(p.w)}"></span><b lang="it">${esc(p.w.italian)}</b> <span class="muted">${esc(p.w.english)}</span></li>`).join("")}</ol>
<ul class="legend skyleg">${STAGES.map((s, i) => `<li><span class="dot k${i}"></span>${s.it} <span class="muted">${s.span}</span></li>`).join("")}</ul>
<p class="sub">Bigger stars have been answered more often. Lines join words that share a note${groups.length ? ` (${groups.length} ${groups.length === 1 ? "constellation" : "constellations"})` : "; none share one yet"}. Hover or tap a star for its English.</p>
</section>`;
}

// ---------------------------------------------------------------- garden

const PETALS = ["#e8505b", "#f28fb1", "#9b6ef3", "#f6b93b", "#f0783c", "#4aa3df", "#d65db1", "#f5d04c"];

// One drawing per stage, 60 × 72, the ground (#soil, drawn apart so a wilting
// plant can droop over it) at y = 66. Colours come from CSS
// variables, so <use> picks up each word's petal colour and the theme.
const PLANT_DEFS = `<defs>
<g id="soil"><ellipse cx="30" cy="66" rx="21" ry="4.5" fill="var(--soil)"/></g>
<g id="leaf"><path d="M0 0 Q-9 -7 -13 -2 Q-7 4 0 0Z" fill="var(--leaf)"/></g>
<symbol id="p0" viewBox="0 0 60 72"><path d="M15 66 Q30 55 45 66Z" fill="var(--soil2)"/><ellipse cx="30" cy="60.5" rx="3.6" ry="2.4" transform="rotate(-25 30 60.5)" fill="var(--seed)"/></symbol>
<symbol id="p1" viewBox="0 0 60 72"><path d="M30 66 Q29 59 30 53" stroke="var(--stem)" stroke-width="2" fill="none" stroke-linecap="round"/><use href="#leaf" transform="translate(30 55) scale(.7)"/><use href="#leaf" transform="translate(30 54) scale(-.7 .7)"/></symbol>
<symbol id="p2" viewBox="0 0 60 72"><path d="M30 66 C30 56 31 46 30 36" stroke="var(--stem)" stroke-width="2.2" fill="none" stroke-linecap="round"/><use href="#leaf" transform="translate(30 58) scale(1)"/><use href="#leaf" transform="translate(30 50) scale(-.95 .95)"/><use href="#leaf" transform="translate(30 42) scale(.75)"/><use href="#leaf" transform="translate(30 38) scale(-.6 .6)"/></symbol>
<symbol id="p3" viewBox="0 0 60 72"><path d="M30 66 C30 54 31 40 30 27" stroke="var(--stem)" stroke-width="2.2" fill="none" stroke-linecap="round"/><use href="#leaf" transform="translate(30 58)"/><use href="#leaf" transform="translate(30 49) scale(-1 1)"/><use href="#leaf" transform="translate(30 40) scale(.8)"/><ellipse cx="30" cy="20" rx="5.5" ry="8.5" fill="var(--petal)"/><path d="M24.5 23 Q30 31 35.5 23 Q33 27.5 30 28 Q27 27.5 24.5 23Z" fill="var(--leaf)"/></symbol>
<symbol id="p4" viewBox="0 0 60 72"><path d="M30 66 C30 54 31 40 30 26" stroke="var(--stem)" stroke-width="2.4" fill="none" stroke-linecap="round"/><use href="#leaf" transform="translate(30 58) scale(1.1)"/><use href="#leaf" transform="translate(30 48) scale(-1.05 1.05)"/><use href="#leaf" transform="translate(30 38) scale(.8)"/><g fill="var(--petal)">${[0, 60, 120, 180, 240, 300].map((r) => `<ellipse cx="30" cy="11.5" rx="4.6" ry="7.5" transform="rotate(${r} 30 19)"/>`).join("")}</g><circle cx="30" cy="19" r="4.6" fill="var(--heart)"/></symbol>
<symbol id="p5" viewBox="0 0 60 72"><path d="M27 66 C28 56 25 50 29 40 M31 66 C32 58 34 52 31 40 M29 46 C25 42 22 40 18 36 M31 44 C35 40 38 37 42 34" stroke="var(--bark)" stroke-width="3" fill="none" stroke-linecap="round"/><g fill="var(--leaf)"><circle cx="30" cy="24" r="13"/><circle cx="18" cy="31" r="9"/><circle cx="42" cy="30" r="9.5"/><circle cx="22" cy="18" r="8"/><circle cx="39" cy="17" r="8"/></g><g fill="var(--leaf2)"><circle cx="27" cy="21" r="6"/><circle cx="40" cy="27" r="5"/><circle cx="18" cy="29" r="4.5"/></g><g fill="var(--olive)"><circle cx="24" cy="30" r="1.9"/><circle cx="35" cy="22" r="1.9"/><circle cx="44" cy="33" r="1.8"/><circle cx="31" cy="33" r="1.7"/><circle cx="19" cy="22" r="1.7"/></g></symbol>
</defs>`;

function gardenView(a: Atlas, token: string): string {
  if (!a.words.length) return empty();
  const coll = new Intl.Collator("it");
  const wilted = (w: AtlasWord) => w.overdue >= WILT_DAYS;
  const plant = (w: AtlasWord) => {
    const s = stage(w);
    const petal = PETALS[Math.floor(hash(w.id) * PETALS.length)];
    const dry = wilted(w);
    return `<figure class="plant s${s}${dry ? " wilt" : ""}" data-tip="${esc(tipOf(w))}" tabindex="0" style="--petal:${petal};--d:-${(hash(w.id + 5) * 6).toFixed(2)}s">`
      + `<svg viewBox="0 0 60 72" aria-hidden="true"><use href="#soil"/><use class="pl" href="#p${s}"/></svg>`
      + `<figcaption>${esc(w.italian)}${dry ? `<small>needs water</small>` : ""}</figcaption></figure>`;
  };
  let beds = "";
  for (let s = STAGES.length - 1; s >= 0; s--) {
    const ws = a.words.filter((w) => stage(w) === s).sort((x, y) => Number(wilted(y)) - Number(wilted(x)) || coll.compare(x.italian, y.italian));
    if (!ws.length) continue;
    const st = STAGES[s];
    beds += `<div class="bed"><h3>${st.it} <span class="muted">· ${st.en.toLowerCase()}, ${st.span} · ${ws.length}</span></h3><div class="plants">${ws.map(plant).join("")}</div></div>`;
  }
  const blooming = a.words.filter((w) => stage(w) >= 4).length;
  const thirsty = a.words.filter(wilted).length;
  return `<section class="card garden"><h2>Il giardino</h2>
<p class="sub">Every word is a plant that grows each time you remember it: a seed, a sprout, a seedling, a bud, a flower, and after three months an olive tree. Forget it and it goes back to a seed. ${blooming} ${blooming === 1 ? "word is" : "words are"} in flower or grown into trees.${thirsty ? ` ${thirsty} ${thirsty === 1 ? "plant is" : "plants are"} wilting, ${WILT_DAYS}+ days overdue: <a href="/drill/${esc(encodeURIComponent(token))}">water them with a drill</a>.` : ""}</p>
<svg width="0" height="0" style="position:absolute" aria-hidden="true">${PLANT_DEFS}</svg>
<div class="stagekey">${STAGES.map((st, i) => `<figure><svg viewBox="0 0 60 72" aria-hidden="true" style="--petal:${PETALS[0]}"><use href="#soil"/><use href="#p${i}"/></svg><figcaption>${st.it}<small>${st.span}</small></figcaption></figure>`).join("")}</div>
${beds}
</section>`;
}

// ----------------------------------------------------------------- cloud

function cloudView(a: Atlas, by: "trouble" | "practice"): string {
  if (!a.words.length) return empty();
  const weight = (w: AtlasWord) => (by === "practice" ? w.attempts : trouble(w));
  const max = Math.max(...a.words.map(weight), 0.0001);
  const ws = [...a.words].sort((x, y) => hash(x.id + 11) - hash(y.id + 11));
  const items = ws.map((w) => {
    const k = Math.sqrt(weight(w) / max);
    const px = Math.round(13 + 34 * k);
    const fw = k > 0.6 ? 700 : k > 0.3 ? 600 : 450;
    const tilt = hash(w.id + 2) < 0.12 ? " tilt" : "";
    return `<span class="cw g${stage(w)}${tilt}" style="font-size:${px}px;font-weight:${fw}" data-tip="${esc(tipOf(w))}" data-it="${esc(w.italian)}" data-en="${esc(w.english)}" tabindex="0">${esc(w.italian)}</span>`;
  });
  const sw = (key: "trouble" | "practice", label: string) =>
    key === by ? `<b>${label}</b>` : `<a href="?view=cloud&by=${key}">${label}</a>`;
  return `<section class="card"><h2>La nuvola</h2>
<p class="sub">All ${a.words.length} words at once. Size: ${sw("trouble", "how often forgotten")} · ${sw("practice", "how often answered")}. Colour: how long you keep it, warm for new, cool for well kept.</p>
<button type="button" class="flip" id="flip" aria-pressed="false">Show in English</button>
<div class="cloud" id="cloud" lang="it">${items.join(" ")}</div>
<ul class="legend">${STAGES.map((s, i) => `<li><span class="sw g${i}"></span>${s.it}</li>`).join("")}</ul>
</section>
<script>
(() => {
  const b = document.getElementById("flip"), c = document.getElementById("cloud");
  b.addEventListener("click", () => {
    const en = b.getAttribute("aria-pressed") !== "true";
    b.setAttribute("aria-pressed", String(en));
    b.textContent = en ? "Mostra in italiano" : "Show in English";
    c.lang = en ? "en" : "it";
    c.querySelectorAll(".cw").forEach((w) => { w.textContent = en ? w.dataset.en : w.dataset.it; });
  });
})();
</script>`;
}

// -------------------------------------------------------------- mistakes

export type Seg = { t: "=" | "-" | "+"; s: string };

/**
 * Letter diff of the right word against what was said, case-insensitive:
 * "=" shared, "-" missing from the answer, "+" said but not in the word.
 */
export function charDiff(want: string, said: string): Seg[] {
  const a = [...want], b = [...said];
  const eq = (x: string, y: string) => x.toLowerCase() === y.toLowerCase();
  const L = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) L[i][j] = eq(a[i], b[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: Seg[] = [];
  const push = (t: Seg["t"], s: string) => {
    const last = out[out.length - 1];
    if (last?.t === t) last.s += s;
    else out.push({ t, s });
  };
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && eq(a[i], b[j])) push("=", b[j++]), i++;
    else if (j < b.length && (i === a.length || L[i][j + 1] >= L[i + 1][j])) push("+", b[j++]);
    else push("-", a[i++]);
  }
  return tidy(out);
}

/**
 * Easier to read: a match of one or two letters between two changes in the
 * same word joins the change ("la"→"il" reads as one swap, not i·l·a), and
 * each change shows what was said before what was missing.
 */
function tidy(segs: Seg[]): Seg[] {
  const out: Seg[] = [];
  let said = "", want = "";
  const flush = () => {
    if (said) out.push({ t: "+", s: said });
    if (want) out.push({ t: "-", s: want });
    said = want = "";
  };
  segs.forEach((g, k) => {
    const inside = k > 0 && k < segs.length - 1 && segs[k - 1].t !== "=" && segs[k + 1].t !== "=";
    if (g.t === "=" && !(inside && [...g.s].length <= 2 && !/\s/.test(g.s))) {
      flush();
      out.push(g);
    } else {
      if (g.t !== "-") said += g.s;
      if (g.t !== "+") want += g.s;
    }
  });
  flush();
  return out;
}

const ARTICLE = /^(il|lo|la|i|gli|le|un|uno|una|l'|un')\s*/i;
const plain = (s: string) => foldText(s).replace(/[.,!?;:"«»]/g, "").replace(/\s+/g, " ").trim();
const bare = (s: string) => plain(s).replace(ARTICLE, "");

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

export const KINDS = {
  accent: { it: "Accento", en: "accent or capital only" },
  article: { it: "Articolo", en: "the article" },
  ending: { it: "Desinenza", en: "the ending" },
  spelling: { it: "Lettere", en: "a letter or two" },
  other: { it: "Altra parola", en: "a different word" },
} as const;
export type MistakeKind = keyof typeof KINDS;

/** What kind of slip an answer is, from the smallest difference up. */
export function mistakeKind(want: string, said: string): MistakeKind {
  if (plain(want) === plain(said)) return "accent";
  const w = bare(want), s = bare(said);
  if (w === s) return "article";
  const stem = Math.max(3, w.length - 2);
  if (w.length >= 4 && s.length >= stem && Math.abs(w.length - s.length) <= 2 && w.slice(0, stem) === s.slice(0, stem)) return "ending";
  if (w.length >= 4 && editDistance(w, s) <= 2) return "spelling";
  return "other";
}

/** Long answers are whole sentences; a letter diff of those would be noise. */
const diffable = (want: string, said: string) => [...said].length <= Math.max(12, [...want].length * 2.5);

function diffHtml(want: string, said: string): string {
  if (!diffable(want, said) || mistakeKind(want, said) === "other") return `<span class="said">${esc(said)}</span>`;
  return charDiff(want, said)
    .map((g) => (g.t === "=" ? esc(g.s) : g.t === "+" ? `<del>${esc(g.s)}</del>` : `<ins>${esc(g.s)}</ins>`))
    .join("");
}

function mistakesView(a: Atlas): string {
  if (!a.mistakes.length) {
    return `<section class="card"><h2>Gli errori</h2><p class="muted">No wrong answers recorded yet. Once you get a word wrong on a ride or in the drill, what you said shows up here next to the right word.</p></section>`;
  }
  const counts = new Map<MistakeKind, number>();
  for (const m of a.mistakes) for (const w of m.wrong) {
    if (!diffable(m.italian, w.answer)) continue;
    const k = mistakeKind(m.italian, w.answer);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((s, n) => s + n, 0);
  const kinds = (Object.keys(KINDS) as MistakeKind[]).filter((k) => counts.get(k));
  const bar = total
    ? `<div class="kbar">${kinds.map((k) => `<div class="kseg ${k}" style="flex:${counts.get(k)}" data-tip="${esc(`${KINDS[k].en}|${KINDS[k].it}|${counts.get(k)} of ${total} answers`)}" tabindex="0"></div>`).join("")}</div>
<ul class="legend">${kinds.map((k) => `<li><span class="sw ${k}"></span>${KINDS[k].it} <span class="muted">${KINDS[k].en} · ${counts.get(k)}</span></li>`).join("")}</ul>`
    : "";
  const cards = a.mistakes.map((m) => {
    const rows = m.wrong.map((w) => {
      const short = diffable(m.italian, w.answer);
      const k = short ? mistakeKind(m.italian, w.answer) : null;
      return `<li><span class="diff">${diffHtml(m.italian, w.answer)}</span>${k ? `<span class="tag ${k}">${KINDS[k].it}</span>` : ""}<span class="when">${esc(shortDate(w.day))}</span></li>`;
    });
    return `<article class="mc"><div class="right" lang="it">${esc(m.italian)}</div><div class="en">${esc(m.english)} · wrong ${times(m.count)}</div><ul class="saids" lang="it">${rows.join("")}</ul></article>`;
  });
  return `<section class="card"><h2>Gli errori</h2>
<p class="sub">What you said, set against the right word. <ins>Green</ins> letters are the ones you left out, <del>red</del> ones you said instead. Answers are speech-to-text, so a few slips may be the transcript's.</p>
${bar}
<div class="mgrid">${cards.join("")}</div>
</section>`;
}

function empty(): string {
  return `<section class="card"><p class="muted">No words yet. Words you ask about or stumble over on a ride land here.</p></section>`;
}

// ------------------------------------------------------------------ page

const themed = (light: string, dark: string) =>
  `:root{${light}}@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${dark}}}:root[data-theme="dark"]{${dark}}`;

const ATLAS_CSS = `${themed(
  "--soil:#8a6a4f;--soil2:#a5815f;--seed:#5b3d26;--stem:#4f8a3a;--leaf:#5aa046;--leaf2:#7cc160;--bark:#7a5a3e;--olive:#3f4b1f;--heart:#7a4a12;"
    + "--g0:#c2410c;--g1:#b45309;--g2:#4d7c0f;--g3:#0f766e;--g4:#1d4ed8;--g5:#6d28d9;"
    + "--accent:#b45309;--article:#7c3aed;--ending:#0f766e;--spelling:#2a78d6;--other:#d03b3b;--ins:#006300;--insbg:#e2f5e2;--del:#c02626;--delbg:#fbe4e4",
  "--soil:#5a4433;--soil2:#6e543f;--seed:#c9a27a;--stem:#5fa04a;--leaf:#5fae4b;--leaf2:#86cc68;--bark:#9a7652;--olive:#26300f;--heart:#ffd166;"
    + "--g0:#fb923c;--g1:#fbbf24;--g2:#a3e635;--g3:#2dd4bf;--g4:#60a5fa;--g5:#c4b5fd;"
    + "--accent:#fbbf24;--article:#a78bfa;--ending:#2dd4bf;--spelling:#60a5fa;--other:#f87171;--ins:#4ade80;--insbg:#12351c;--del:#fca5a5;--delbg:#3d1414",
)}
.serif,.right,.cloud,.plant figcaption,.stagekey figcaption{font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif}
.views{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 2px}
.views a{display:block;padding:7px 12px;border-radius:999px;border:1px solid var(--ring);color:var(--ink2);text-decoration:none;font-size:14px;background:var(--surface)}
.views a[aria-current]{background:var(--ink);color:var(--page);border-color:var(--ink)}
.views .amb{margin-left:auto}
.legend{display:flex;flex-wrap:wrap;gap:6px 14px;list-style:none;padding:0;margin:10px 0 0;font-size:12px;color:var(--ink2)}
.legend li{display:flex;align-items:center;gap:6px}
.sw{width:12px;height:12px;border-radius:3px;display:inline-block}
[tabindex]:focus-visible{outline:2px solid var(--s1);outline-offset:2px}
/* sky */
.sky{background:#0a0f26;border-color:#1e2750;color:#e9ecf8}.sky h2{color:#fff}.sky .sub,.sky .muted{color:#b7bedc}
.skysvg{display:block;width:100%;max-width:940px;margin:6px auto 0;height:auto}
.sky .legend{color:#e9ecf8}
h3.closest{font-size:13px;font-weight:600;margin:14px 0 4px;color:#e9ecf8}
ol.closest{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:4px 16px;font-size:14px}
ol.closest li{display:flex;align-items:center;gap:8px;min-width:0}ol.closest b{font-weight:600}
@media (max-width:600px){.slbl{display:none}}
.dust circle{fill:#fff;opacity:.35}
.orbit{fill:none;stroke:#8ea2ff;stroke-opacity:.16;stroke-dasharray:2 5}
.olbl{fill:#8ea2ff;fill-opacity:.55;font-size:10px;text-anchor:middle}
.cline{fill:none;stroke:#cdd6ff;stroke-opacity:.28;stroke-width:1}
.cname{fill:#cdd6ff;fill-opacity:.6;font-size:11px;font-style:italic;letter-spacing:.04em}
.star{cursor:pointer;outline:none}
.star .halo{opacity:.18}.star:hover .halo,.star:focus .halo{opacity:.45}
.slbl{fill:#e9ecf8;fill-opacity:.85;font-size:11px;pointer-events:none}
.k0{--c:#ff7a59}.k1{--c:#ffb347}.k2{--c:#ffe08a}.k3{--c:#b9f3e4}.k4{--c:#9fd0ff}.k5{--c:#ffffff}
.star .core,.star .halo{fill:var(--c)}
.dot{width:10px;height:10px;border-radius:50%;background:var(--c);box-shadow:0 0 6px var(--c);display:inline-block}
.due .core,.due .halo{animation:twinkle 2.6s ease-in-out infinite;animation-delay:var(--d)}
@keyframes twinkle{0%,100%{opacity:1}50%{opacity:.35}}
.due .halo{animation-name:twinkleh}@keyframes twinkleh{0%,100%{opacity:.18}50%{opacity:.5}}
/* garden */
.garden{background:linear-gradient(180deg,var(--surface),color-mix(in srgb,var(--leaf) 7%,var(--surface)))}
.bed{margin-top:16px}.bed h3{font-size:15px;margin:0 0 6px;font-weight:600}
.plants{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:4px 6px;border-bottom:3px solid color-mix(in srgb,var(--soil) 45%,transparent);padding-bottom:6px}
.plant{margin:0;text-align:center;outline:none;border-radius:10px;padding:2px 0}
.plant:hover,.plant:focus{background:color-mix(in srgb,var(--leaf) 10%,transparent)}
.plant svg{width:66px;height:79px;display:block;margin:0 auto;overflow:visible}
.plant .pl{transform-origin:30px 66px;animation:sway 6s ease-in-out infinite;animation-delay:var(--d)}
@keyframes sway{0%,100%{transform:rotate(-2deg)}50%{transform:rotate(2deg)}}
.plant.wilt svg{filter:saturate(.3) sepia(.45)}.plant.wilt .pl{animation:none;transform:rotate(-16deg) scale(.94)}.plant.wilt.s0 .pl{transform:none}
.plant figcaption,.stagekey figcaption{font-size:13px;line-height:1.2;overflow-wrap:anywhere}
.plant small,.stagekey small{display:block;font:11px system-ui,sans-serif;color:var(--muted)}
.plant.wilt small{color:var(--bad)}
.stagekey{display:grid;grid-template-columns:repeat(6,1fr);gap:4px;margin-top:8px;padding:8px 0;border-top:1px solid var(--grid);border-bottom:1px solid var(--grid)}
.stagekey figure{margin:0;text-align:center}.stagekey svg{width:44px;height:53px}
@media (max-width:560px){.stagekey{grid-template-columns:repeat(3,1fr)}}
/* cloud */
.cloud{display:flex;flex-wrap:wrap;justify-content:center;align-items:baseline;gap:4px 14px;padding:18px 4px 8px;line-height:1.15}
.cw{cursor:default;outline:none;border-radius:4px;transition:transform .15s}
.cw:hover,.cw:focus{transform:scale(1.08)}.cw.tilt{font-style:italic}
.g0{color:var(--g0)}.g1{color:var(--g1)}.g2{color:var(--g2)}.g3{color:var(--g3)}.g4{color:var(--g4)}.g5{color:var(--g5)}
.sw.g0{background:var(--g0)}.sw.g1{background:var(--g1)}.sw.g2{background:var(--g2)}.sw.g3{background:var(--g3)}.sw.g4{background:var(--g4)}.sw.g5{background:var(--g5)}
.flip{font:inherit;font-size:13px;padding:6px 12px;border-radius:8px;border:1px solid var(--ring);background:var(--page);color:var(--ink);cursor:pointer}
/* mistakes */
.kbar{display:flex;gap:2px;height:16px;margin-top:10px}.kseg{outline:none}.kseg:first-child{border-radius:4px 0 0 4px}.kseg:last-child{border-radius:0 4px 4px 0}.kseg:only-child{border-radius:4px}
.accent{--k:var(--accent)}.article{--k:var(--article)}.ending{--k:var(--ending)}.spelling{--k:var(--spelling)}.other{--k:var(--other)}
.kseg,.sw.accent,.sw.article,.sw.ending,.sw.spelling,.sw.other{background:var(--k)}
.mgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px;margin-top:14px}
.mc{border:1px solid var(--ring);border-radius:10px;padding:12px 12px 8px;background:var(--page)}
.right{font-size:24px;font-weight:600;line-height:1.15;overflow-wrap:anywhere}
.mc .en{font-size:13px;color:var(--ink2);margin-top:2px}
.saids{list-style:none;padding:0;margin:8px 0 0;font-size:16px}
.saids li{display:flex;align-items:baseline;gap:8px;padding:5px 0;border-top:1px dashed var(--grid);flex-wrap:wrap}
.diff{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:15px;overflow-wrap:anywhere}
.said{font-family:system-ui,sans-serif;font-style:italic;color:var(--ink2);font-size:14px}
ins{text-decoration:none;color:var(--ins);background:var(--insbg);border-bottom:2px solid var(--ins);border-radius:2px}
del{color:var(--del);background:var(--delbg);text-decoration-thickness:2px;border-radius:2px}
.tag{font-size:11px;padding:1px 7px;border-radius:999px;color:var(--k);border:1px solid var(--k)}
.when{margin-left:auto;font-size:12px;color:var(--muted)}
@media (prefers-reduced-motion:reduce){.due .core,.due .halo,.plant .pl{animation:none}}
${TIP_CSS}`;

const VIEW_LABELS: Record<AtlasView, { it: string; en: string }> = {
  sky: { it: "Cielo", en: "Sky" },
  garden: { it: "Giardino", en: "Garden" },
  cloud: { it: "Nuvola", en: "Cloud" },
  mistakes: { it: "Errori", en: "Mistakes" },
};

export function atlasView(v: unknown): AtlasView {
  return VIEWS.find((x) => x === v) ?? "sky";
}

export function renderAtlas(a: Atlas, token: string, view: AtlasView, by: "trouble" | "practice" = "trouble"): string {
  const t = esc(encodeURIComponent(token));
  const tabs = VIEWS.map((v) => `<a href="/atlas/${t}?view=${v}"${v === view ? ' aria-current="page"' : ""}>${VIEW_LABELS[v].it} <span class="muted">${VIEW_LABELS[v].en}</span></a>`).join("");
  const body = { sky: () => skyView(a), garden: () => gardenView(a, token), cloud: () => cloudView(a, by), mistakes: () => mistakesView(a) }[view]();
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><meta name="robots" content="noindex">
<title>Word atlas · ${VIEW_LABELS[view].en}</title>
<style>${PAGE_CSS}
${ATLAS_CSS}</style></head><body><main>
${nav(token, "atlas")}
<h1 class="serif">Atlante delle parole</h1>
<p class="sub">Your ${a.words.length} ${a.words.length === 1 ? "word" : "words"}, drawn four ways · as of ${esc(shortDate(a.today))}</p>
<div class="views">${tabs}<a class="amb" href="/ambient/${t}">Screensaver ↗</a></div>
${body}
</main>
${TIP_HTML}
</body></html>`;
}

// --------------------------------------------------------------- ambient

export interface AmbientOptions {
  /** Seconds per word. */
  every: number;
  /** Seconds before the answer fades in. */
  reveal: number;
  n: number;
  side: "italian" | "english";
}

export function ambientOptions(q: Record<string, unknown>): AmbientOptions {
  const int = (v: unknown, def: number, min: number, max: number) => {
    const n = Number(v);
    return v !== undefined && v !== "" && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
  };
  const every = int(q.every, 20, 5, 600);
  return { every, reveal: int(q.reveal, Math.round(every / 3), 0, every), n: int(q.n, 30, 3, 200), side: q.side === "english" ? "english" : "italian" };
}

/**
 * The words for the screensaver: what hasn't stuck yet (interval under three
 * weeks, or due), due ones first, then the most troublesome; all words when
 * fewer than five qualify.
 */
export function ambientWords(words: AtlasWord[], n: number): AtlasWord[] {
  const open = words.filter((w) => w.interval < 21 || w.due);
  return (open.length >= 5 ? open : words)
    .slice()
    .sort((x, y) => Number(y.due) - Number(x.due) || trouble(y) - trouble(x) || x.id - y.id)
    .slice(0, n);
}

/** JSON inside a <script> element: escape "<" so text like "</script>" can't end it. */
const scriptJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

export function renderAmbient(words: AtlasWord[], token: string, o: AmbientOptions): string {
  const t = encodeURIComponent(token);
  const items = words.map((w) => {
    const sentence = w.example ?? w.context;
    return {
      it: w.italian,
      en: w.english,
      note: w.note,
      ctx: sentence ? markWord(sentence, w.italian) : null,
      pic: w.pic === null ? null : `/pic/${t}/${w.id}?v=${w.pic}`,
      hue: Math.round(hash(w.id) * 360),
    };
  });
  return `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><meta name="robots" content="noindex">
<title>Parole</title>
<style>
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:#05060a;color:#fff;overflow:hidden;font:16px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;cursor:none}
body.awake{cursor:default}
.layer{position:fixed;inset:0;opacity:0;transition:opacity 2.2s ease}
.layer.on{opacity:1}
.bg{position:absolute;inset:-6%;background-size:cover;background-position:center;filter:brightness(.42) saturate(.9)}
.on .bg{animation:drift var(--every) linear forwards}
@keyframes drift{from{transform:scale(1) translate(0,0)}to{transform:scale(1.12) translate(-2%,-1.5%)}}
.glow{position:absolute;inset:0;background:radial-gradient(60% 50% at 30% 35%,hsl(var(--hue) 70% 32% / .55),transparent 70%),radial-gradient(50% 45% at 72% 68%,hsl(calc(var(--hue) + 60) 70% 28% / .5),transparent 70%)}
.on .glow{animation:breathe var(--every) ease-in-out forwards}
@keyframes breathe{from{transform:scale(1)}to{transform:scale(1.15) rotate(4deg)}}
.text{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:6vh 8vw}
.it{font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;font-size:clamp(40px,9vw,128px);font-weight:600;line-height:1.05;letter-spacing:-.01em;text-shadow:0 2px 30px rgba(0,0,0,.5);overflow-wrap:anywhere}
.on .it{animation:rise 1.6s ease both}
@keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
.after{margin-top:3vh;opacity:0;transition:opacity 1.6s ease;max-width:900px}
.shown .after{opacity:1}
.en{font-size:clamp(20px,3.4vw,40px);color:rgba(255,255,255,.86)}
.note{font-size:clamp(13px,1.6vw,18px);color:rgba(255,255,255,.6);margin-top:.4em;letter-spacing:.06em;text-transform:lowercase}
.ctx{font-family:"Iowan Old Style",Palatino,Georgia,serif;font-style:italic;font-size:clamp(16px,2.2vw,26px);color:rgba(255,255,255,.75);margin-top:1.4em}
.ctx b{color:#fff;font-weight:600;font-style:normal}
.foot{position:fixed;left:0;right:0;bottom:0;display:flex;align-items:flex-end;justify-content:space-between;padding:0 4vw 3.5vh;color:rgba(255,255,255,.55);font-variant-numeric:tabular-nums;pointer-events:none}
.clock{font-size:clamp(28px,4vw,52px);font-weight:300;color:rgba(255,255,255,.7);letter-spacing:.02em}
.pos{font-size:13px}
.bar{position:fixed;left:0;bottom:0;height:2px;background:rgba(255,255,255,.35);width:0}
.hint{position:fixed;top:3vh;left:0;right:0;text-align:center;font-size:13px;color:rgba(255,255,255,.6);transition:opacity .8s;opacity:0}
.awake .hint{opacity:1}
.hint a{color:inherit}
.empty{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.7);font-size:20px;text-align:center;padding:24px}
@media (prefers-reduced-motion:reduce){.on .bg,.on .glow,.on .it{animation:none}.layer{transition:none}}
</style></head><body>
${items.length ? `<div class="layer" id="l0"></div><div class="layer" id="l1"></div>
<div class="foot"><span class="clock" id="clock"></span><span class="pos" id="pos"></span></div><div class="bar" id="bar"></div>
<div class="hint">Click or Space: next · F: full screen · Esc: leave · <a href="/atlas/${esc(t)}">back to the atlas</a></div>` : `<div class="empty">No words to show yet.</div>`}
<script type="application/json" id="data">${scriptJson({ items, every: o.every, reveal: o.reveal, side: o.side })}</script>
<script>
(() => {
  const d = JSON.parse(document.getElementById("data").textContent);
  if (!d.items.length) return;
  // A fresh order each visit, due and hard words still early: shuffle within blocks of five.
  const items = d.items.slice();
  for (let s = 0; s < items.length; s += 5) {
    for (let i = Math.min(items.length, s + 5) - 1; i > s; i--) {
      const j = s + Math.floor(Math.random() * (i - s + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
  }
  const layers = [document.getElementById("l0"), document.getElementById("l1")];
  const bar = document.getElementById("bar"), pos = document.getElementById("pos"), clock = document.getElementById("clock");
  document.documentElement.style.setProperty("--every", d.every + 4 + "s");
  let at = -1, front = 0, timer = 0, revealTimer = 0, shownAt = 0;
  const el = (tag, cls, text) => { const e = document.createElement(tag); e.className = cls; if (text) e.textContent = text; return e; };
  const paint = (layer, w) => {
    layer.replaceChildren();
    layer.style.setProperty("--hue", w.hue);
    if (w.pic) { const bg = el("div", "bg"); bg.style.backgroundImage = "url(" + JSON.stringify(w.pic) + ")"; layer.append(bg); }
    else layer.append(el("div", "glow"));
    const text = el("div", "text");
    const first = d.side === "english" ? w.en : w.it, second = d.side === "english" ? w.it : w.en;
    text.append(el("div", "it", first));
    const after = el("div", "after");
    after.append(el("div", "en", second));
    if (w.note) after.append(el("div", "note", w.note));
    if (w.ctx) { const c = el("div", "ctx"); c.innerHTML = w.ctx; after.append(c); }
    text.append(after);
    layer.append(text);
  };
  const next = () => {
    clearTimeout(timer); clearTimeout(revealTimer);
    at = (at + 1) % items.length;
    const back = layers[front], cur = layers[1 - front];
    paint(cur, items[at]);
    void cur.offsetWidth;
    cur.classList.add("on"); back.classList.remove("on", "shown");
    front = 1 - front;
    pos.textContent = (at + 1) + " / " + items.length;
    shownAt = Date.now();
    revealTimer = setTimeout(() => cur.classList.add("shown"), d.reveal * 1000);
    timer = setTimeout(next, d.every * 1000);
  };
  const advance = () => { const cur = layers[front]; if (!cur.classList.contains("shown")) { clearTimeout(revealTimer); cur.classList.add("shown"); } else next(); };
  const tick = () => {
    const now = new Date();
    clock.textContent = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
    bar.style.width = Math.min(100, (Date.now() - shownAt) / (d.every * 10)) + "%";
  };
  setInterval(tick, 250); tick();
  let idle = 0;
  const wake = () => { document.body.classList.add("awake"); clearTimeout(idle); idle = setTimeout(() => document.body.classList.remove("awake"), 3000); };
  document.addEventListener("pointermove", wake);
  document.addEventListener("click", (e) => { if (e.target.closest("a")) return; wake(); advance(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); advance(); }
    else if (e.key === "f" || e.key === "F") { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.().catch(() => {}); }
    else if (e.key === "Escape" && !document.fullscreenElement) location.href = ${JSON.stringify(`/atlas/${t}`).replace(/</g, "\\u003c")};
  });
  // Keep the screen on while it runs, where the browser allows it.
  let lock = null;
  const keepAwake = async () => { try { lock = await navigator.wakeLock?.request("screen"); } catch {} };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") keepAwake(); });
  keepAwake();
  wake();
  next();
})();
</script>
</body></html>`;
}

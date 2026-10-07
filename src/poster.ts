// The printable poster: the words you forget most, laid out to print and put
// up at home. Three layouts: one poster sheet ranked by how forgettable each
// word is, a picture wall of photo tiles, or a sheet of cut-out cards to stick
// on the fridge, the mirror, the door. Photos come from the word's stored
// picture (see pictures.ts) and are credited at the foot of the sheet. Each word carries its answer history as a row of squares (filled =
// forgot, hollow = remembered), so the shape reads without colour too.

import { esc, nav, PAGE_CSS } from "./page.js";
import { credit, type PhotoSource, SOURCE_NAMES } from "./pictures.js";
import { shortDate } from "./stats.js";
import type { ForgettableWord } from "./store.js";

export type PaperSize = "a4" | "a3" | "letter";
export type PosterLayout = "poster" | "pictures" | "cards";
export type Ink = "color" | "mono";

export interface PosterOptions {
  size: PaperSize;
  layout: PosterLayout;
  n: number;
  ink: Ink;
}

const PAPER: Record<PaperSize, { w: number; h: number; k: number; label: string }> = {
  a4: { w: 210, h: 297, k: 1, label: "A4" },
  a3: { w: 297, h: 420, k: 1.414, label: "A3" },
  letter: { w: 215.9, h: 279.4, k: 0.96, label: "US Letter" },
};
const COUNTS = [8, 12, 16, 20, 24];
const CARDS_PER_SHEET = 8;
const TILES_PER_SHEET = 12;
const PER_SHEET: Record<PosterLayout, number> = { poster: Infinity, pictures: TILES_PER_SHEET, cards: CARDS_PER_SHEET };

/** Options from the query string; anything unknown falls back to the default. */
export function posterOptions(q: Record<string, unknown>): PosterOptions {
  const pick = <T extends string>(v: unknown, all: readonly T[], d: T): T => all.find((x) => x === v) ?? d;
  const layout = pick(q.layout, ["poster", "pictures", "cards"] as const, "poster");
  const n = Number(q.n);
  return {
    size: pick(q.size, ["a4", "a3", "letter"] as const, "a4"),
    layout,
    n: COUNTS.includes(n) ? n : { poster: 16, pictures: 12, cards: 8 }[layout],
    ink: pick(q.ink, ["color", "mono"] as const, "color"),
  };
}

const ARTICLE = /^(il|lo|la|i|gli|le|un|uno|una|l'|un')\s*/i;

/** Whole-word occurrences of `needle` in `hay` (both lower-cased), as [start, end]. */
function wholeMatches(hay: string, needle: string): [number, number][] {
  const out: [number, number][] = [];
  const letter = (c: string | undefined) => c !== undefined && /\p{L}/u.test(c);
  for (let i = needle ? hay.indexOf(needle) : -1; i >= 0; i = hay.indexOf(needle, i + 1)) {
    const end = i + needle.length;
    if (!letter(hay[i - 1]) && !letter(hay[end])) {
      out.push([i, end]);
      i = end - 1;
    }
  }
  return out;
}

/**
 * A sentence, escaped, with the word in bold: the whole phrase where
 * it appears as is, else without its article ("la ciotola" in "nella ciotola").
 */
export function markWord(context: string, word: string): string {
  const hay = context.toLowerCase(), w = word.toLowerCase().trim();
  let spans = wholeMatches(hay, w);
  if (!spans.length && ARTICLE.test(w)) spans = wholeMatches(hay, w.replace(ARTICLE, ""));
  let out = "", at = 0;
  for (const [i, end] of spans) {
    out += `${esc(context.slice(at, i))}<b>${esc(context.slice(i, end))}</b>`;
    at = end;
  }
  return out + esc(context.slice(at));
}

/** Answer history as squares, oldest first: filled = forgot (grade < 3), hollow = remembered. */
function meter(grades: number[]): string {
  const s = 5, gap = 2;
  const w = grades.length * (s + gap) - gap;
  const marks = grades
    .map((g, i) => {
      const x = i * (s + gap);
      return g < 3
        ? `<rect class="mf" x="${x}" y="0" width="${s}" height="${s}" rx="0.8"/>`
        : `<rect class="mp" x="${x + 0.4}" y="0.4" width="${s - 0.8}" height="${s - 0.8}" rx="0.6"/>`;
    })
    .join("");
  return `<svg class="meter" viewBox="0 0 ${Math.max(w, 1)} ${s}" aria-hidden="true">${marks}</svg>`;
}

const sizeClass = (italian: string) => (italian.length > 40 ? " l3" : italian.length > 24 ? " l2" : italian.length > 14 ? " l1" : "");

function lapseLine(w: ForgettableWord, long: boolean): string {
  const times = w.lapses === 1 ? "once" : `${w.lapses} times`;
  if (!long) return w.lapses ? `forgot ${w.lapses}×` : "hard to keep";
  const last = w.last_lapse ? ` · last ${esc(shortDate(w.last_lapse))}` : "";
  return w.lapses ? `forgot ${times} in ${w.attempts} answers${last}` : `remembered with effort, ${w.attempts} answers`;
}

/** The stored photo of a word, or "" without one. */
type PicUrl = (w: ForgettableWord) => string;

function photo(w: ForgettableWord, url: PicUrl, cls = "pic"): string {
  return w.pic === null ? "" : `<img class="${cls}" src="${url(w)}" alt="">`;
}

/** "Photos: 1 Name / Pexels · 3 Name, CC BY-SA 4.0 / Wikimedia Commons" for the words with a photo. */
function credits(words: [number, ForgettableWord][]): string {
  const list = words
    .filter(([, w]) => w.pic !== null)
    .map(([rank, w]) => `${rank} ${esc(credit({ source: w.pic_source ?? "", author: w.pic_author, license: w.pic_license }))}`);
  return list.length ? `<div class="cr">${list.length === 1 && words.length === 1 ? "Photo" : "Photos"}: ${list.join(" · ")}</div>` : "";
}

function word(w: ForgettableWord, rank: number, cls: string, long = false, history = 12, url?: PicUrl): string {
  const pic = url ? photo(w, url) : "";
  // The tutor's example is correct Italian; the context is what was said, garbled or not.
  const sentence = w.example ?? w.context;
  return `<article class="w ${cls}${pic ? " has-pic" : ""}">
  ${pic}<span class="rk">${rank}</span>
  <div class="it${sizeClass(w.italian)}" lang="it">${esc(w.italian)}</div>
  <div class="en">${esc(w.english)}${w.note ? ` <span class="nt">· ${esc(w.note)}</span>` : ""}</div>
  ${sentence ? `<div class="ctx" lang="it">${markWord(sentence, w.italian)}</div>` : ""}
  <div class="ft">${meter(w.grades.slice(-history))}<span>${lapseLine(w, long)}</span></div>
</article>`;
}

const LEGEND = `<span class="lg">${meter([0])} forgot ${meter([5])} remembered</span> one square per recent answer, oldest first`;

function posterSheet(words: ForgettableWord[], today: string, url: PicUrl): string {
  const [hero, ...others] = words;
  const tier2 = others.slice(0, 3);
  const rest = others.slice(3);
  const lapses = words.reduce((a, w) => a + w.lapses, 0);
  // From 20 words the small cards get one line of context and a shorter history.
  // Up to 12 words they get three roomier columns instead of four.
  const dense = rest.length > 12, cols = rest.length <= 9 ? 3 : 4;
  return `<div class="sheet poster${dense ? " dense" : ""}${cols === 3 ? " roomy" : ""}">
<div class="flag"><i></i><i></i><i></i></div>
<header class="ph">
  <div class="kick">Italiano · da ripassare</div>
  <h1 lang="it">Le parole che scappano</h1>
  <p>The ${words.length} ${words.length === 1 ? "word" : "words"} I forget most${lapses ? `, forgotten ${lapses} ${lapses === 1 ? "time" : "times"} in all` : ""} · ${esc(shortDate(today))} ${today.slice(0, 4)}</p>
</header>
${word(hero, 1, "hero", true, 12, url)}
${tier2.length ? `<section class="t2">${tier2.map((w, i) => word(w, i + 2, "mid", true)).join("")}</section>` : ""}
${rest.length ? `<section class="rest" style="--rows:${Math.ceil(rest.length / cols)};--cols:${cols}">${rest.map((w, i) => word(w, i + 5, "sm", false, dense ? 8 : 10)).join("")}</section>` : ""}
<footer class="pf"><span>${LEGEND}</span><span>Ranked by how often and how recently each word slipped away.</span>${credits([[1, hero]])}</footer>
</div>`;
}

function tile(w: ForgettableWord, rank: number, url: PicUrl): string {
  return `<article class="tile${w.pic === null ? " nopic" : ""}">
  ${w.pic === null ? `<div class="ph0" aria-hidden="true">${esc(w.italian.replace(/^(il|lo|la|i|gli|le|l')\s*/i, "").charAt(0).toUpperCase())}</div>` : photo(w, url)}
  <span class="rk">${rank}</span>
  <div class="band">
    <div class="it${sizeClass(w.italian)}" lang="it">${esc(w.italian)}</div>
    <div class="en">${esc(w.english)}</div>
    <div class="ft">${meter(w.grades.slice(-8))}<span>${lapseLine(w, false)}</span></div>
  </div>
</article>`;
}

function pictureSheets(words: ForgettableWord[], today: string, url: PicUrl): string {
  const sheets: string[] = [];
  const pages = Math.ceil(words.length / TILES_PER_SHEET);
  for (let i = 0; i < words.length; i += TILES_PER_SHEET) {
    const chunk = words.slice(i, i + TILES_PER_SHEET);
    sheets.push(`<div class="sheet pictures">
<div class="flag"><i></i><i></i><i></i></div>
<header class="ph compact">
  <h1 lang="it">Le parole che scappano</h1>
  <p>The words I forget most · ${esc(shortDate(today))} ${today.slice(0, 4)}${pages > 1 ? ` · ${i / TILES_PER_SHEET + 1}/${pages}` : ""}</p>
</header>
<section class="wall">${chunk.map((w, j) => tile(w, i + j + 1, url)).join("")}</section>
<footer class="pf"><span>${LEGEND}</span>${credits(chunk.map((w, j) => [i + j + 1, w]))}</footer>
</div>`);
  }
  return sheets.join("\n");
}

function cardSheets(words: ForgettableWord[], url: PicUrl): string {
  const sheets: string[] = [];
  for (let i = 0; i < words.length; i += CARDS_PER_SHEET) {
    const chunk = words.slice(i, i + CARDS_PER_SHEET);
    sheets.push(`<div class="sheet cards">
<div class="cut">✂ Cut along the dashed lines and stick each word where you'll see it: the fridge, the mirror, the front door.</div>
<section class="grid">${chunk.map((w, j) => word(w, i + j + 1, "cd", true, 12, url)).join("")}${'<article class="w cd blank"></article>'.repeat(CARDS_PER_SHEET - chunk.length)}</section>
<footer class="pf"><span>${LEGEND}</span><span>Le parole che scappano · ${i / CARDS_PER_SHEET + 1}/${Math.ceil(words.length / CARDS_PER_SHEET)}</span>${credits(chunk.map((w, j) => [i + j + 1, w]))}</footer>
</div>`);
  }
  return sheets.join("\n");
}

export function renderPoster(
  token: string,
  o: PosterOptions,
  data: { today: string; words: ForgettableWord[] },
  ui: { msg?: string; err?: string; photoSource?: PhotoSource } = {},
): string {
  const p = PAPER[o.size];
  const base = `/poster/${encodeURIComponent(token)}`;
  const url: PicUrl = (w) => `/pic/${encodeURIComponent(token)}/${w.id}?v=${w.pic}`;
  const missing = data.words.filter((w) => w.pic === null).length;
  const sheetCount = o.layout === "poster" ? 1 : Math.ceil(data.words.length / PER_SHEET[o.layout]);
  const hidden = (o2: PosterOptions) =>
    Object.entries(o2).map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join("");
  const select = (name: string, cur: string | number, opts: [string | number, string][]) =>
    `<label>${esc(name)}<select name="${name.toLowerCase() === "words" ? "n" : name.toLowerCase()}">${opts
      .map(([v, l]) => `<option value="${v}"${v === cur ? " selected" : ""}>${esc(l)}</option>`)
      .join("")}</select></label>`;
  const sheets = !data.words.length
    ? ""
    : o.layout === "poster"
      ? posterSheet(data.words, data.today, url)
      : o.layout === "pictures"
        ? pictureSheets(data.words, data.today, url)
        : cardSheets(data.words, url);
  const source = SOURCE_NAMES[ui.photoSource ?? "wikimedia"];

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Words to put up</title>
<style>
${PAGE_CSS}
@page{size:${p.w}mm ${p.h}mm;margin:0}
${POSTER_CSS}
.sheet{width:${p.w}mm;height:${p.h}mm;--k:${p.k}}
@media print{.sheet{height:${p.h - 0.5}mm}}
</style></head><body class="ink-${o.ink}"><main class="pp">
<div class="chrome">
${nav(token, "poster")}
<h1>Words to put up</h1>
<p class="sub">The words you forget most, ready to print and hang at home. Choose a layout, then print, or save as PDF from the print dialog.</p>
<form class="bar" method="get" action="${base}">
  ${select("Layout", o.layout, [["poster", "Poster"], ["pictures", "Picture wall"], ["cards", "Cut-out cards"]])}
  ${select("Words", o.n, COUNTS.map((c) => [c, String(c)]))}
  ${select("Size", o.size, Object.entries(PAPER).map(([k, v]) => [k, v.label]))}
  ${select("Ink", o.ink, [["color", "Colour"], ["mono", "Black & white"]])}
  <noscript><button>Update</button></noscript>
  <button type="button" class="primary" id="print"${data.words.length ? "" : " disabled"}>Print</button>
</form>
${ui.msg ? `<div class="banner ok" role="status">${esc(ui.msg)}</div>` : ""}
${ui.err ? `<div class="banner err" role="alert">${esc(ui.err)}</div>` : ""}
${data.words.length && missing ? `<form class="photos" method="post" action="${base}/photos">${hidden(o)}
  <button>Find photos for ${missing === data.words.length ? `all ${missing} words` : `the ${missing} ${missing === 1 ? "word" : "words"} without one`}</button>
  <span class="sub">The first match on ${esc(source)} for each English meaning. To choose a different photo, open the word on the <a href="/items/${encodeURIComponent(token)}">Words page</a>.</span>
</form>` : ""}
${data.words.length ? `<p class="sub">In the print dialog, keep the scale at 100% and choose ${esc(p.label)}. ${sheetCount === 1 ? "One sheet." : `${sheetCount} sheets.`}${data.words.length < o.n ? ` Only ${data.words.length} ${data.words.length === 1 ? "word has" : "words have"} been forgotten so far.` : ""}</p>` : `<div class="card"><b>Nothing to put up yet.</b> <span class="muted">A word appears here once you've forgotten it in a drill, or answered it with difficulty.</span></div>`}
</div>
<div class="paper">${sheets}</div>
</main>
<script>
(() => {
  const form = document.querySelector("form.bar");
  form.addEventListener("change", () => form.submit());
  document.getElementById("print").addEventListener("click", () => window.print());
  // A word whose text doesn't fit its box loses its sentence, then
  // its note, then its Italian shrinks, rather than printing a line cut in half.
  // Measured with the history row unpinned from the bottom (.measuring), with
  // 2px to spare: printed sheets are half a millimetre shorter.
  document.body.classList.add("measuring");
  const fits = (w) => {
    // Clipping happens at the box's edge; running into its padding is fine.
    const r = w.getBoundingClientRect(), top = r.top - 0.5, bottom = r.bottom - 2;
    return [...w.children].every((c) => {
      if (getComputedStyle(c).position === "absolute") return true;
      const b = c.getBoundingClientRect();
      return b.top >= top && b.bottom <= bottom;
    });
  };
  for (const w of document.querySelectorAll(".sheet .w")) {
    for (const sel of [".ctx", ".nt"]) {
      if (fits(w)) break;
      w.querySelectorAll(sel).forEach((e) => e.remove());
    }
    const it = w.querySelector(".it");
    for (const z of [0.85, 0.72, 0.6]) {
      if (fits(w) || !it) break;
      it.style.zoom = String(z);
    }
  }
  document.body.classList.remove("measuring");
  const sheets = document.querySelectorAll(".sheet");
  const fit = () => {
    for (const s of sheets) {
      s.style.zoom = "";
      const z = Math.min(1, (document.querySelector(".paper").clientWidth) / s.offsetWidth);
      s.style.zoom = z < 1 ? String(z) : "";
    }
  };
  addEventListener("resize", fit);
  fit();
})();
</script>
</body></html>`;
}

const POSTER_CSS = `main.pp{max-width:none;padding-bottom:32px}
.chrome{max-width:880px;margin:0 auto}
.bar{display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px;margin:8px 0 6px}
.bar label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--ink2)}
.bar select,.bar button{font:inherit;color:var(--ink);background:var(--surface);border:1px solid var(--base);border-radius:8px;padding:8px 10px}
.bar button{cursor:pointer;padding:8px 18px}.bar .primary{background:var(--s1);border-color:var(--s1);color:#fff;font-weight:600}
.bar button:disabled{opacity:.5;cursor:default}
.paper{display:flex;flex-direction:column;align-items:center;gap:24px;margin-top:18px}

/* The sheet is paper: always white, whatever the screen theme. */
.sheet{--ink:#151515;--ink2:#45443f;--muted:#85847e;--rule:#d6d5cf;--tint:#f5f4ef;--hot:#c4302b;--fg:#009246;--fw:#ffffff;--fr:#ce2b37;
background:#fff;color:var(--ink);box-shadow:0 2px 6px rgba(0,0,0,.12),0 18px 40px -16px rgba(0,0,0,.35);
padding:calc(12mm * var(--k));font:calc(10pt * var(--k))/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;
display:flex;flex-direction:column;gap:calc(4mm * var(--k));overflow:hidden;position:relative;flex:none;
-webkit-print-color-adjust:exact;print-color-adjust:exact}
.ink-mono .sheet{--hot:#151515;--fg:#151515;--fw:#ffffff;--fr:#151515;--tint:#ffffff}
.sheet .flag{position:absolute;inset:0 0 auto 0;display:flex}
.sheet .flag i{flex:1;border-top:calc(3mm * var(--k)) solid var(--fg)}
.sheet .flag i:nth-child(2){border-top-color:var(--fw)}.sheet .flag i:nth-child(3){border-top-color:var(--fr)}
.sheet .flag i:nth-child(2){border-top-color:#ecebe6}.ink-mono .sheet .flag i:nth-child(2){border-top-color:#bbb}
.serif,.sheet h1,.sheet .it{font-family:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif}
.ph{border-bottom:0.3mm solid var(--ink);padding-bottom:calc(3mm * var(--k))}
.kick{font-size:.8em;letter-spacing:.18em;text-transform:uppercase;color:var(--hot);font-weight:700}
.sheet h1{font-size:3.4em;line-height:1;margin:.1em 0 .12em;font-weight:700;letter-spacing:-.01em}
.ph p{margin:0;color:var(--ink2);font-size:1.05em}
.w{position:relative;display:flex;flex-direction:column;min-height:0;overflow:hidden;break-inside:avoid}
.rk{position:absolute;top:0;right:0;font:700 .9em/1 system-ui,sans-serif;color:var(--muted);font-variant-numeric:tabular-nums}
.it{font-weight:700;line-height:1.05;color:var(--ink);overflow-wrap:break-word;padding-right:1.6em}
.w>*{flex-shrink:0}
.measuring .w .ft{margin-top:0!important}
.it.l1{font-size:.85em}.it.l2{font-size:.7em}.it.l3{font-size:.55em}
.en{color:var(--ink2);margin-top:.25em}.nt{color:var(--muted)}
.ctx{font-style:italic;color:var(--ink2);margin-top:.45em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ctx b{font-style:normal;color:var(--ink);text-decoration:underline;text-decoration-color:var(--hot);text-underline-offset:.15em;text-decoration-thickness:.12em}
.ft{display:flex;align-items:center;gap:.6em;margin-top:auto;padding-top:.6em;font-size:.82em;color:var(--muted)}
.meter{height:.8em;width:auto;flex:none}
.mf{fill:var(--hot)}.mp{fill:none;stroke:var(--muted);stroke-width:.8}
.hero{flex:none;padding:calc(5mm * var(--k)) calc(6mm * var(--k));background:var(--tint);border-left:calc(2.2mm * var(--k)) solid var(--hot);border-radius:0 calc(3mm * var(--k)) calc(3mm * var(--k)) 0}
.ink-mono .hero{border:0.3mm solid var(--ink);border-left-width:calc(2.2mm * var(--k))}
.hero .rk{top:calc(4mm * var(--k));right:calc(5mm * var(--k));font-size:3em;color:var(--hot);font-family:"Iowan Old Style",Palatino,Georgia,serif}
.hero .it{font-size:5em}.hero .en{font-size:1.5em}.hero .ctx{font-size:1.15em;-webkit-line-clamp:2}.hero .ft{font-size:1em}
.t2{flex:none;display:grid;grid-template-columns:repeat(3,1fr);gap:calc(4mm * var(--k))}
.mid{border-top:0.6mm solid var(--ink);padding-top:calc(2.5mm * var(--k))}
.mid .rk{top:calc(2.5mm * var(--k));font-size:1.3em;color:var(--hot)}
.mid .it{font-size:2.5em}.mid .en{font-size:1.1em}
.rest{flex:1;min-height:0;display:grid;grid-template-columns:repeat(var(--cols),1fr);grid-template-rows:repeat(var(--rows),minmax(0,calc(40mm * var(--k))));gap:calc(3mm * var(--k)) calc(4mm * var(--k));align-content:start}
.sm{border-top:0.3mm solid var(--rule);padding-top:calc(2mm * var(--k))}
.sm .rk{top:calc(2mm * var(--k))}
.sm .it{font-size:1.65em}.sm .en{font-size:.95em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.sm .ctx{font-size:.85em}
.sm .ft{gap:.45em;white-space:nowrap}.sm .meter{height:.7em}
.dense{gap:calc(3mm * var(--k))}.dense .hero{padding:calc(4mm * var(--k)) calc(6mm * var(--k))}.dense .hero .it{font-size:4em}
.dense .mid .it{font-size:2.1em}.dense .mid .ctx{-webkit-line-clamp:1}
.dense .sm .it{font-size:1.45em}.dense .sm .en{-webkit-line-clamp:1}.dense .sm .ctx{-webkit-line-clamp:1}
.dense .sm .it:is(.l1,.l2,.l3)~.ctx{display:none}
.roomy .rest{grid-template-rows:repeat(var(--rows),minmax(0,calc(44mm * var(--k))));gap:calc(4mm * var(--k)) calc(5mm * var(--k))}
.roomy .sm .it{font-size:2.1em}.roomy .sm .en{font-size:1.1em}.roomy .sm .ctx{font-size:1em}.roomy .sm .ft{font-size:.9em}
.pf{flex:none;margin-top:auto;display:flex;justify-content:space-between;flex-wrap:wrap;gap:.4em 1.5em;font-size:.8em;color:var(--muted);border-top:0.3mm solid var(--rule);padding-top:calc(2mm * var(--k))}
.lg{color:var(--ink2);margin-right:.3em}.lg .meter{vertical-align:-.1em;margin:0 .15em 0 .5em}.lg .meter:first-child{margin-left:0}
.cards .cut{font-size:.85em;color:var(--muted);margin-top:calc(-2mm * var(--k))}
.cards .grid{flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:repeat(4,minmax(0,1fr));border-top:0.3mm dashed var(--muted);border-left:0.3mm dashed var(--muted)}
.cd{border-right:0.3mm dashed var(--muted);border-bottom:0.3mm dashed var(--muted);padding:calc(6mm * var(--k));text-align:center;align-items:center;justify-content:center}
.cd::before{content:"";position:absolute;left:0;right:0;top:0;height:calc(1.4mm * var(--k));background:linear-gradient(90deg,var(--fg) 0 33.4%,var(--fw) 33.4% 66.6%,var(--fr) 66.6%);margin:0 calc(6mm * var(--k))}
.cd.blank::before{display:none}
.cd .rk{top:calc(3.5mm * var(--k));right:calc(4mm * var(--k))}
.cd .it{font-size:3em;padding:0 .2em}.cd .en{font-size:1.25em;margin-top:.35em}
.cd .ctx{font-size:1em;max-width:30em;margin-top:.7em}
.cd .ft{margin-top:.9em;padding-top:0;flex-direction:column;gap:.35em}
.banner{border-radius:8px;padding:8px 12px;margin:8px 0;font-size:14px;border:1px solid}
.banner.ok{border-color:var(--good);color:var(--good)}.banner.err{border-color:var(--bad);color:var(--bad)}
form.photos{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;margin:10px 0 4px}
form.photos button{font:inherit;color:var(--ink);background:var(--surface);border:1px solid var(--base);border-radius:8px;padding:8px 14px;cursor:pointer}
form.photos .sub{margin:0}
.ink-mono .sheet img{filter:grayscale(1) contrast(1.05)}
.cr{flex-basis:100%;font-size:.9em;color:var(--muted);line-height:1.25}
/* The top word's photo, to the right of the text. */
.hero.has-pic{padding-right:calc(42% + 6mm * var(--k));min-height:calc(42mm * var(--k))}
.hero.has-pic .it{font-size:3.8em}
.hero .pic{position:absolute;top:0;right:0;bottom:0;width:42%;height:100%;object-fit:cover}
.hero.has-pic .rk{right:calc(42% + 4mm * var(--k))}
/* Picture wall: photo tiles, three across. */
.ph.compact{padding-bottom:calc(2mm * var(--k))}.ph.compact h1{font-size:2.4em}
.wall{flex:1;min-height:0;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(4,minmax(0,1fr));gap:calc(3.5mm * var(--k))}
.tile{position:relative;display:flex;flex-direction:column;min-height:0;overflow:hidden;border:0.3mm solid var(--rule);border-radius:calc(2.5mm * var(--k));break-inside:avoid}
.tile .pic{flex:1;min-height:0;width:100%;object-fit:cover;display:block}
.tile .ph0{flex:1;min-height:0;display:grid;place-items:center;background:var(--tint);color:var(--rule);font:700 5em/1 "Iowan Old Style",Palatino,Georgia,serif}
.tile .rk{left:calc(2mm * var(--k));right:auto;top:calc(2mm * var(--k));background:#fff;color:var(--ink);border-radius:999px;padding:.25em .6em;box-shadow:0 0 0 0.3mm var(--rule)}
.tile:first-child .rk{background:var(--hot);color:#fff;box-shadow:none}
.tile .band{flex:none;padding:calc(2mm * var(--k)) calc(3mm * var(--k)) calc(2.2mm * var(--k));border-top:calc(1mm * var(--k)) solid var(--hot);background:#fff}
.tile .it{font-size:1.75em;padding-right:0}.tile .en{font-size:.95em;margin-top:.1em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tile .ft{padding-top:.35em;font-size:.8em;white-space:nowrap}.tile .meter{height:.7em}
/* Cut-out cards: the photo along the top. */
.cd.has-pic{justify-content:flex-start;padding-top:calc(4mm * var(--k))}
.cd .pic{width:100%;height:40%;min-height:0;flex:none;object-fit:cover;border-radius:calc(2mm * var(--k));margin-bottom:.5em}
.cd.has-pic .it{font-size:2.5em}.cd.has-pic .ctx{-webkit-line-clamp:1}
.cd.has-pic .rk{top:calc(5.5mm * var(--k));right:calc(5.5mm * var(--k));background:#fff;border-radius:999px;padding:.2em .5em;z-index:1}
@media print{
  html,body{background:#fff!important}
  .chrome{display:none!important}
  main.pp{padding:0;margin:0}
  .paper{display:block;margin:0}
  .sheet{box-shadow:none;zoom:1!important;break-after:page}
  .sheet:last-child{break-after:auto}
}
`;

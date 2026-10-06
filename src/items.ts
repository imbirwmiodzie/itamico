// The Words page: full-text search over the vocabulary, with edit, reset,
// delete and add. Plain HTML forms posting back to the server, so it works on
// a phone without any script.

import { esc, nav, PAGE_CSS } from "./page.js";
import { type Candidate, credit, type PhotoSource, photoQuery, SOURCE_NAMES } from "./pictures.js";
import { type ItemFilter, SOURCES } from "./store.js";

interface Attempt {
  at: string;
  mode: string;
  prompt: string | null;
  answer: string | null;
  grade: number;
  fillers: number;
}

export interface ItemRow {
  id: number;
  italian: string;
  english: string;
  note: string | null;
  context: string | null;
  source: string;
  ease: number;
  interval_days: number;
  repetitions: number;
  due_on: string;
  due: boolean;
  created: string;
  attempts: number;
  history: Attempt[];
  pic: number | null;
  pic_source: string | null;
  pic_author: string | null;
  pic_license: string | null;
}

export interface ItemsView {
  token: string;
  q: string;
  filter: ItemFilter;
  items: ItemRow[];
  total: number;
  msg?: string;
  err?: string;
  open?: number;
  /** Photo search results for one word, when asked for. */
  photos?: { id: number; query: string; candidates: Candidate[]; err?: string };
  photoSource?: PhotoSource;
}

const FILTERS: [ItemFilter, string][] = [
  ["all", "All words"],
  ["due", "Due today"],
  ["nocontext", "Missing context"],
  ["failed", "Ever failed"],
];

function stage(i: ItemRow): string {
  if (i.repetitions === 0) return "not recalled yet";
  if (i.interval_days < 7) return "learning";
  if (i.interval_days < 21) return "young";
  return "mature";
}

function sourceSelect(current: string): string {
  return `<select name="source">${SOURCES.map((s) => `<option${s === current ? " selected" : ""}>${s}</option>`).join("")}</select>`;
}

function keep(v: ItemsView): string {
  return `<input type="hidden" name="q" value="${esc(v.q)}"><input type="hidden" name="filter" value="${esc(v.filter)}">`;
}

function photoSection(i: ItemRow, v: ItemsView, base: string): string {
  const pic = `/pic/${encodeURIComponent(v.token)}/${i.id}?v=${i.pic}`;
  const current = i.pic !== null
    ? `<figure class="cur"><img src="${pic}" alt="Photo for ${esc(i.italian)}"><figcaption>${esc(credit({ source: i.pic_source ?? "", author: i.pic_author, license: i.pic_license }))}</figcaption></figure>`
    : `<p class="sub">No photo yet. Search for one to show on the poster, the cards and in the drill.</p>`;
  const found = v.photos?.id === i.id ? v.photos : undefined;
  const query = found?.query ?? photoQuery(i.english);
  const candidates = found
    ? found.err
      ? `<div class="banner err" role="alert">${esc(found.err)}</div>`
      : found.candidates.length
        ? `<p class="sub">Tap a photo to use it.</p><div class="cands">${found.candidates
            .map(
              (c) => `<form method="post" action="${base}/${i.id}">${keep(v)}<input type="hidden" name="action" value="photo"><input type="hidden" name="pq" value="${esc(found.query)}"><input type="hidden" name="cand" value="${esc(JSON.stringify(c))}">
<button class="cand" title="${esc(c.alt ?? "")}"><img src="${esc(c.thumb)}" alt="${esc(c.alt ?? "")}" loading="lazy"><span>${esc(credit(c))}</span></button></form>`,
            )
            .join("")}</div>`
        : `<p class="sub">Nothing found for “${esc(found.query)}”. Try another word, e.g. a concrete thing that reminds you of it.</p>`
    : "";
  return `<h3 id="p${i.id}">Photo</h3>
<div class="photo">${current}
<form method="get" action="${base}#p${i.id}" class="psearch">
  <input type="hidden" name="q" value="${esc(v.q)}"><input type="hidden" name="filter" value="${esc(v.filter)}"><input type="hidden" name="photos" value="${i.id}">
  <input type="search" name="pq" value="${esc(query)}" aria-label="Search photos for" maxlength="100">
  <button>${i.pic !== null ? "Find another" : "Find photos"}</button>
</form>
${i.pic !== null ? `<form method="post" action="${base}/${i.id}" class="premove">${keep(v)}<button name="action" value="nophoto" class="danger">Remove photo</button></form>` : ""}
</div>
${candidates}
<p class="sub">Photos from ${esc(SOURCE_NAMES[v.photoSource ?? "wikimedia"])}. The chosen one is saved with the word.</p>`;
}

function itemCard(i: ItemRow, v: ItemsView, base: string): string {
  const history = i.history.length
    ? `<div class="scroll"><table class="hist"><thead><tr><th>When</th><th class="sm-hide">Mode</th><th>Prompt</th><th>Answer</th><th>Grade</th><th>Fillers</th></tr></thead><tbody>${i.history
        .map(
          (h) =>
            `<tr><td>${esc(h.at)}</td><td class="sm-hide">${esc(h.mode)}</td><td>${esc(h.prompt)}</td><td>${esc(h.answer)}</td><td class="${h.grade >= 3 ? "good" : "bad"}">${h.grade}</td><td>${h.fillers}</td></tr>`,
        )
        .join("")}</tbody></table></div>${i.attempts > i.history.length ? `<p class="sub">Last ${i.history.length} of ${i.attempts} answers.</p>` : ""}`
    : `<p class="sub">Not drilled yet.</p>`;

  return `<details class="item card" id="i${i.id}"${v.open === i.id ? " open" : ""}>
<summary>
  ${i.pic !== null ? `<img class="thumb" src="/pic/${encodeURIComponent(v.token)}/${i.id}?v=${i.pic}" alt="" loading="lazy">` : ""}<span class="it">${esc(i.italian)}</span> <span class="en">${esc(i.english)}</span>
  <span class="meta">${i.due ? `<span class="due">due</span> · ` : `next ${esc(i.due_on)} · `}${stage(i)} · ${i.attempts} ${i.attempts === 1 ? "answer" : "answers"}</span>
  ${i.context ? `<span class="ctx">“${esc(i.context)}”</span>` : ""}
</summary>
<form method="post" action="${base}/${i.id}" class="edit">
  ${keep(v)}
  <label>Italian<input name="italian" value="${esc(i.italian)}" required maxlength="200"></label>
  <label>English<input name="english" value="${esc(i.english)}" required maxlength="200"></label>
  <label>Note<input name="note" value="${esc(i.note)}" maxlength="200" placeholder="e.g. masculine"></label>
  <label>Source${sourceSelect(i.source)}</label>
  <label class="wide">Context<textarea name="context" rows="2" maxlength="500" placeholder="The sentence it came up in">${esc(i.context)}</textarea></label>
  <div class="buttons">
    <button name="action" value="save" class="primary">Save</button>
    <button name="action" value="reset" formnovalidate title="Due today, learning starts over">Make due today</button>
    <button name="action" value="delete" formnovalidate class="danger" onclick="return confirm('Delete “${esc(i.italian.replace(/['\\]/g, ""))}” and its answer history?')">Delete</button>
  </div>
  <p class="sub">Ease ${i.ease.toFixed(2)} · interval ${i.interval_days} ${i.interval_days === 1 ? "day" : "days"} · added ${esc(i.created)} · id ${i.id}</p>
</form>
${photoSection(i, v, base)}
<h3>Answer history</h3>
${history}
</details>`;
}

export function renderItems(v: ItemsView): string {
  const base = `/items/${encodeURIComponent(v.token)}`;
  const shown = v.items.length;
  const summary = v.q || v.filter !== "all"
    ? `${v.total} ${v.total === 1 ? "match" : "matches"}${shown < v.total ? `, showing ${shown}` : ""}`
    : `${v.total} words${shown < v.total ? `, showing the ${shown} most recently captured` : ", most recently captured first"}`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Italian words</title>
<style>
${PAGE_CSS}
form.search{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 8px}
input,select,textarea,button{font:inherit;color:var(--ink)}
input,select,textarea{background:var(--surface);border:1px solid var(--base);border-radius:8px;padding:8px 10px;width:100%}
textarea{resize:vertical}
form.search input[type=search]{flex:1 1 240px;width:auto}form.search select{width:auto}
button{background:var(--surface);border:1px solid var(--base);border-radius:8px;padding:8px 14px;cursor:pointer}
button.primary{background:var(--s1);border-color:var(--s1);color:#fff}
button.danger{color:var(--bad);border-color:var(--bad)}
.banner{border-radius:8px;padding:8px 12px;margin:8px 0;font-size:14px;border:1px solid}
.banner.ok{border-color:var(--good);color:var(--good)}.banner.err{border-color:var(--bad);color:var(--bad)}
.good{color:var(--good)}.bad{color:var(--bad)}
.item summary{cursor:pointer;list-style:none;display:flex;flex-wrap:wrap;gap:2px 8px;align-items:baseline}
.item summary::-webkit-details-marker{display:none}
.it{font-weight:600;font-size:16px}.en{color:var(--ink2)}
.meta{font-size:12px;color:var(--muted);margin-left:auto}.due{color:var(--s1);font-weight:600}
.ctx{flex-basis:100%;font-size:13px;color:var(--ink2);font-style:italic}
form.edit{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}
form.edit label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--ink2)}
form.edit .wide,form.edit .buttons,form.edit .sub{grid-column:1/-1}
.buttons{display:flex;flex-wrap:wrap;gap:8px}
h3{font-size:13px;margin:14px 0 0;color:var(--ink2);font-weight:500}
.scroll{overflow-x:auto}
.thumb{width:36px;height:36px;border-radius:6px;object-fit:cover;align-self:center}
.photo{display:flex;flex-wrap:wrap;align-items:flex-start;gap:10px;margin-top:6px}
.photo .cur{margin:0}.photo .cur img{display:block;width:160px;height:120px;object-fit:cover;border-radius:8px}
.photo figcaption{font-size:11px;color:var(--muted);max-width:160px;margin-top:2px}
.psearch{display:flex;gap:8px;flex:1 1 240px}.psearch input{flex:1}
.cands{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-top:6px}
.cand{padding:0;overflow:hidden;width:100%;display:flex;flex-direction:column;text-align:left}
.cand img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;background:var(--grid)}
.cand span{font-size:11px;color:var(--muted);padding:4px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cand:hover{border-color:var(--s1);box-shadow:0 0 0 2px var(--s1)}
.hist td:first-child{white-space:nowrap}
@media (max-width:600px){form.edit{grid-template-columns:1fr}.meta{margin-left:0;flex-basis:100%}.sm-hide{display:none}}
</style></head><body><main>
${nav(v.token, "items")}
<h1>Words</h1>
<form class="search" method="get" action="${base}" role="search">
  <input type="search" name="q" value="${esc(v.q)}" placeholder="Search Italian, English, notes, context…" aria-label="Search" autofocus>
  <select name="filter" aria-label="Filter">${FILTERS.map(([k, label]) => `<option value="${k}"${k === v.filter ? " selected" : ""}>${label}</option>`).join("")}</select>
  <button class="primary">Search</button>
</form>
${v.msg ? `<div class="banner ok" role="status">${esc(v.msg)}</div>` : ""}
${v.err ? `<div class="banner err" role="alert">${esc(v.err)}</div>` : ""}
<p class="sub">${summary}. Tap a word to edit it or see its answers.</p>

<details class="card"><summary><b>Add a word</b></summary>
<form method="post" action="${base}/new" class="edit">
  ${keep(v)}
  <label>Italian<input name="italian" required maxlength="200"></label>
  <label>English<input name="english" required maxlength="200"></label>
  <label>Note<input name="note" maxlength="200"></label>
  <label>Source${sourceSelect("asked")}</label>
  <label class="wide">Context<textarea name="context" rows="2" maxlength="500"></textarea></label>
  <div class="buttons"><button class="primary">Add</button></div>
  <p class="sub">An existing word (same Italian) is not duplicated: it becomes due today again.</p>
</form></details>

${v.items.map((i) => itemCard(i, v, base)).join("\n")}
${shown === 0 ? `<p class="muted">Nothing found.</p>` : ""}
</main></body></html>`;
}

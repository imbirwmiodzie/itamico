// Grammatica: grammar lessons built from your own words, at /grammar/<token>.
//
// The lessons themselves (rules, forms, exercises) are in src/lessons.ts and
// the word forms in src/italian.ts; this file draws the page: the lesson list,
// grouped, and one lesson at a time with its rules, your words' forms and a
// practice round. Practising grammar is not recalling the word, so it never
// touches the SM-2 schedule.

import { buildLessons, GROUPS, type Lesson } from "./lessons.js";
import type { GrammarWord } from "./italian.js";
import { esc, nav, PAGE_CSS } from "./page.js";

/** JSON for a <script type="application/json"> block: `<` can't close the element. */
function scriptJson(v: unknown): string {
  return JSON.stringify(v).replace(/</g, "\\u003c");
}

const ROUND = 10;

export function renderGrammar(token: string, list: GrammarWord[], key: string): string {
  const t = encodeURIComponent(token);
  const lessons = buildLessons(list);
  const lesson = lessons.find((l) => l.key === key);
  const head = (title: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>
${PAGE_CSS}
${GRAMMAR_CSS}
</style></head><body><main class="grammar">
${nav(token, "grammar")}`;

  if (!lesson) return `${head("Grammatica")}${renderIndex(t, lessons)}
</main>
<script>${BEST_JS}</script>
</body></html>`;

  const ruleList = lesson.rules
    .map((r) => {
      const yours = [...new Set(lesson.rows.flatMap((row) => (row.ex[r.key] ? [row.ex[r.key]] : [])))];
      const ex = yours.length
        ? `<div class="ex"><span class="lbl">Your words</span>${yours.slice(0, 6).map((e) => `<span class="chip" lang="it">${esc(e)}</span>`).join("")}${yours.length > 6 ? `<span class="more">+${yours.length - 6}</span>` : ""}</div>`
        : r.stock.length
          ? `<div class="ex stock"><span class="lbl">For example</span>${r.stock.map((e) => `<span class="chip" lang="it">${esc(e)}</span>`).join("")}</div>`
          : "";
      return `<div class="rule"><div class="rt" lang="it">${esc(r.title)}</div><div class="rd"><p>${esc(r.text)}</p>${ex}</div></div>`;
    })
    .join("\n");

  const english = lesson.cols.at(-1) === "English";
  const table = lesson.rows.length
    ? `<div class="scroll"><table class="forms"><thead><tr>${lesson.cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>
${lesson.rows
  .map((r) => `<tr>${r.cells.map((c, i) => `<td${english && i === r.cells.length - 1 ? ' class="en"' : ' lang="it"'}>${esc(c)}</td>`).join("")}</tr>`)
  .join("\n")}
</tbody></table></div>`
    : `<p class="muted">None of your words fit this lesson yet. ${esc(NEEDS[lesson.key] ?? "")} Add some on the <a href="/items/${t}">Words page</a>.</p>`;

  const practice = lesson.exercises.length
    ? `<section class="card practice" id="practice">
  <div id="p-intro">
    <h2>Practice</h2>
    <p class="sub">${Math.min(ROUND, lesson.exercises.length)} questions on your words${lesson.kind === "type" ? ", typed" : ""}. <span id="p-best"></span></p>
    <button type="button" class="primary" id="p-start">Start <kbd>Enter</kbd></button>
  </div>
  <div id="p-play" hidden>
    <div class="progress"><span id="p-n"></span><div class="bar"><div id="p-bar"></div></div><span id="p-score"></span></div>
    <div class="kicker">${esc(lesson.ask)}</div>
    <div class="q" id="p-q" lang="it"></div>
    <div class="gloss" id="p-en"></div>
    <div class="opts" id="p-opts" hidden></div>
    <form id="p-form" autocomplete="off" hidden>
      <input id="p-input" lang="it" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Your answer">
      <div class="accents">${["à", "è", "é", "ì", "ò", "ù"].map((a) => `<button type="button" data-ch="${a}" tabindex="-1">${a}</button>`).join("")}</div>
      <button type="submit" class="primary">Check <kbd>Enter</kbd></button>
    </form>
    <div class="result" id="p-result" hidden></div>
  </div>
  <div id="p-over" hidden>
    <h2 id="p-final"></h2>
    <div id="p-missed"></div>
    <button type="button" class="primary" id="p-again">Again <kbd>Enter</kbd></button>
  </div>
</section>`
    : "";

  return `${head(lesson.it)}
<p class="back"><a href="/grammar/${t}">← All lessons</a> · <span class="muted">${esc(lesson.group)}</span></p>
<h1 lang="it">${esc(lesson.it)}</h1>
<p class="sub">${esc(lesson.title)}</p>
<p class="intro">${esc(lesson.intro)}</p>
${practice}
<section class="card"><h2>The rules</h2>
${ruleList}
</section>
<section class="card"><h2>Your words</h2>
${table}
</section>
</main>
<script type="application/json" id="data">${scriptJson({
    key: lesson.key,
    kind: lesson.kind,
    round: ROUND,
    rules: Object.fromEntries(lesson.rules.map((r) => [r.key, `${r.title}: ${r.text}`])),
    exercises: lesson.exercises,
  })}</script>
<script>${CLIENT_JS}</script>
</body></html>`;
}

// What a lesson needs from the list, said when none of the words fit.
const NOUNS = "Nouns count when they're saved with their article (lo schermo).";
const VERBS = "Verbs count when they're saved as the infinitive with an English “to …” (cercare: to look for).";
const ADJS = "Adjectives count when they're saved on their own in the masculine, with an English adjective (stanco: tired).";
const NEEDS: Record<string, string> = {
  articoli: NOUNS, un: NOUNS, plurale: NOUNS, dimostrativi: NOUNS, possessivi: NOUNS, preposizioni: NOUNS, pronomi: NOUNS, cine: NOUNS, relativi: NOUNS,
  piacere: `${NOUNS} ${VERBS}`, passivo: `${NOUNS} ${VERBS}`, negazione: `${NOUNS} ${VERBS}`, aggettivi: ADJS, comparativi: ADJS,
};

function renderIndex(t: string, lessons: Lesson[]): string {
  const card = (l: Lesson) => {
    const sample = l.rows.slice(0, 3).map((r) => `<span lang="it">${esc(r.cells[0])}</span>`).join("");
    return `<a class="lesson" href="/grammar/${t}?l=${l.key}">
  <span class="it" lang="it">${esc(l.it)}</span>
  <span class="en">${esc(l.title)}</span>
  <span class="count">${l.rows.length ? `${l.rows.length} of your words` : "None of your words yet"}</span>
  ${sample ? `<span class="sample">${sample}</span>` : ""}
  <span class="best" data-best="${l.key}"></span>
</a>`;
  };
  return `
<h1>Grammatica</h1>
<p class="sub">${lessons.length} lessons built from your own words: the rules shown with them, then practice on their forms. Practice here doesn't change when words are due.</p>
${GROUPS.map((g) => `<h2 class="group" lang="it">${esc(g)}</h2>
<div class="lessons">
${lessons.filter((l) => l.group === g).map(card).join("\n")}
</div>`).join("\n")}`;
}

const GRAMMAR_CSS = `:root{--it-green:#009246;--it-white:#f1f2ec;--it-red:#ce2b37;--ok:#11804a;--no:#c22f2f;--warn:#a06c00}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--it-white:#d9dad3;--ok:#2fd28a;--no:#f0716a;--warn:#e5c14a}}
:root[data-theme="dark"]{--it-white:#d9dad3;--ok:#2fd28a;--no:#f0716a;--warn:#e5c14a}
[hidden]{display:none!important}
main.grammar{max-width:760px}
[lang=it]{font-family:ui-serif,"Iowan Old Style","Palatino Linotype",Georgia,serif}
kbd{font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;border:1px solid currentColor;border-radius:5px;padding:2px 5px;opacity:.6;margin-left:6px}
@media (hover:none){kbd{display:none}}
h1[lang=it]{font-size:28px;font-weight:600}
.back{margin:0 0 6px;font-size:14px}.back a{color:var(--ink2);text-decoration:none}
.intro{max-width:62ch;margin:6px 0 4px}
h2.group{font-size:18px;font-weight:600;margin:22px 0 4px}
.lessons{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-top:8px}
.lesson{position:relative;display:flex;flex-direction:column;gap:4px;padding:18px 16px 14px;border-radius:14px;background:var(--surface);border:1px solid var(--ring);color:var(--ink);text-decoration:none;overflow:hidden;transition:border-color .12s,transform .12s}
.lesson::before,.practice::before{content:"";position:absolute;inset:0 0 auto 0;height:4px;background:linear-gradient(90deg,var(--it-green) 0 33.4%,var(--it-white) 33.4% 66.6%,var(--it-red) 66.6%)}
.lesson:hover{border-color:var(--ink2)}.lesson:active{transform:scale(.99)}
.lesson .it{font-size:20px}.lesson .en{font-size:13px;color:var(--ink2)}
.lesson .count{font-size:12px;color:var(--muted);margin-top:6px}
.lesson .sample{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:14px;color:var(--ink2)}
.lesson .best{font-size:12px;color:var(--ok);font-weight:600}
.rule{display:grid;grid-template-columns:150px 1fr;gap:4px 16px;padding:10px 0;border-top:1px solid var(--grid)}
.rule:first-of-type{border-top:0}
.rt{font-size:17px;font-weight:600}.rd p{margin:0 0 6px}
.ex{display:flex;flex-wrap:wrap;gap:6px;align-items:baseline}
.ex .lbl{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-right:2px}
.chip{font-size:15px;background:color-mix(in srgb,var(--it-green) 10%,var(--page));border:1px solid color-mix(in srgb,var(--it-green) 30%,transparent);border-radius:8px;padding:1px 8px}
.ex.stock .chip{background:var(--page);border-color:var(--grid);color:var(--ink2)}
.more{font-size:12px;color:var(--muted)}
.scroll{overflow-x:auto;margin:0 -4px}
.forms td[lang=it]{font-size:15px;font-variant-numeric:normal}.forms td:first-child{font-weight:600}
.forms td.en{color:var(--ink2)}
.practice{position:relative;overflow:hidden;padding:22px 18px 18px}
.practice h2{font-size:18px}
.primary{font:inherit;font-size:16px;font-weight:600;color:#fff;background:var(--it-green);border:1px solid var(--it-green);border-radius:12px;padding:10px 22px;cursor:pointer}
.progress{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;font-size:13px;color:var(--ink2);font-variant-numeric:tabular-nums}
.bar{height:6px;border-radius:3px;background:var(--grid);overflow:hidden}#p-bar{height:100%;width:0;background:var(--it-green);transition:width .2s}
.kicker{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:600;margin-top:16px}
.q{font-size:clamp(24px,5vw,30px);line-height:1.2;margin:6px 0 2px}
.gloss{color:var(--ink2);margin-bottom:14px}
.opts{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.opt{position:relative;font:inherit;font-family:ui-serif,"Iowan Old Style","Palatino Linotype",Georgia,serif;font-size:18px;text-align:left;color:var(--ink);background:var(--page);border:1.5px solid var(--base);border-radius:12px;padding:12px 12px 12px 40px;cursor:pointer}
.opt .k{position:absolute;left:11px;top:50%;transform:translateY(-50%);width:20px;height:20px;border-radius:6px;border:1px solid var(--base);display:grid;place-items:center;font:600 11px/1 system-ui,sans-serif;color:var(--muted)}
.opt:hover{border-color:var(--ink2)}.opt:disabled{cursor:default}.opt:disabled:not(.ok):not(.no){opacity:.5}
.opt.ok{border-color:var(--ok);background:color-mix(in srgb,var(--ok) 14%,var(--page))}
.opt.no{border-color:var(--no);background:color-mix(in srgb,var(--no) 12%,var(--page));text-decoration:line-through}
#p-form{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
#p-input{flex:1 1 240px;font:inherit;font-family:ui-serif,"Iowan Old Style","Palatino Linotype",Georgia,serif;font-size:20px;color:var(--ink);background:var(--page);border:1.5px solid var(--base);border-radius:12px;padding:10px 12px}
#p-input:focus{outline:2px solid var(--s1);outline-offset:1px}
.accents{display:flex;gap:4px}
.accents button{font:inherit;font-size:16px;width:34px;height:34px;color:var(--ink);background:var(--page);border:1px solid var(--grid);border-radius:8px;cursor:pointer}
.result{margin-top:14px;padding:12px 14px;border-radius:12px;background:var(--page);border-left:4px solid var(--base)}
.result.ok{border-left-color:var(--ok)}.result.no{border-left-color:var(--no)}.result.close{border-left-color:var(--warn)}
.result .verdict{font-weight:700}.result.ok .verdict{color:var(--ok)}.result.no .verdict{color:var(--no)}.result.close .verdict{color:var(--warn)}
.result .ans{font-family:ui-serif,"Iowan Old Style","Palatino Linotype",Georgia,serif;font-size:19px;margin:2px 0}
.result .full{font-family:ui-serif,"Iowan Old Style","Palatino Linotype",Georgia,serif;color:var(--ink2);margin:2px 0}
.result .why{font-size:13px;color:var(--ink2);margin:6px 0 10px}
.result button{font:inherit;font-size:14px;color:var(--ink);background:var(--surface);border:1px solid var(--base);border-radius:10px;padding:7px 14px;cursor:pointer}
#p-missed ul{list-style:none;padding:0;margin:6px 0 14px}
#p-missed li{padding:7px 0;border-top:1px solid var(--grid);display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline}
#p-missed .q2{color:var(--ink2)}#p-missed .a2{font-family:ui-serif,"Iowan Old Style","Palatino Linotype",Georgia,serif;font-size:17px;color:var(--ok)}
#p-missed .you{color:var(--no);text-decoration:line-through;font-size:14px}
#toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:var(--ink);color:var(--page);padding:10px 16px;border-radius:12px;font-size:14px}
@media (max-width:560px){.rule{grid-template-columns:1fr}.opts{grid-template-columns:1fr}}
`;

// Best score per lesson, kept in this browser only.
const BEST_JS = String.raw`
(() => {
  for (const el of document.querySelectorAll("[data-best]")) {
    try {
      const b = JSON.parse(localStorage.getItem("grammar-best-" + el.dataset.best) || "null");
      if (b) el.textContent = "Best " + b.right + "/" + b.of;
    } catch (e) {}
  }
})();
`;

// Client script. Kept as String.raw with no backticks or template holes, so
// regex escapes reach the browser unchanged.
const CLIENT_JS = String.raw`
(() => {
  const D = JSON.parse(document.getElementById("data").textContent);
  const $ = (id) => document.getElementById(id);
  if (!D.exercises.length) return;
  const KEY = "grammar-best-" + D.key;
  const norm = (s) => s.trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s*'\s*/g, "'").replace(/[.!?,;]+$/, "").replace(/\s+/g, " ");
  const bare = (s) => norm(s).normalize("NFD").replace(/[̀-ͯ]/g, "");
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

  let qs = [], i = 0, right = 0, missed = [], answered = false;

  function readBest() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; } }
  function showBest() { const b = readBest(); $("p-best").textContent = b ? "Best " + b.right + "/" + b.of + "." : ""; }

  // One question per word first, so a round covers as many words as it can.
  function pick() {
    const all = shuffle(D.exercises.slice()), seen = new Set(), first = [], rest = [];
    for (const e of all) (seen.has(e.id) ? rest : first).push(e), seen.add(e.id);
    return first.concat(rest).slice(0, D.round);
  }

  function start() {
    qs = pick(); i = 0; right = 0; missed = [];
    $("p-intro").hidden = true; $("p-over").hidden = true; $("p-play").hidden = false;
    show();
  }

  function show() {
    answered = false;
    const e = qs[i];
    $("p-n").textContent = (i + 1) + " / " + qs.length;
    $("p-bar").style.width = (100 * i / qs.length) + "%";
    $("p-score").textContent = right + " right";
    $("p-q").textContent = e.q;
    $("p-en").textContent = e.en;
    $("p-result").hidden = true;
    if (D.kind === "choice") {
      const opts = $("p-opts");
      opts.hidden = false;
      opts.replaceChildren();
      e.shown = shuffle(e.opts.slice());
      e.shown.forEach((o, k) => {
        const b = el("button", "opt");
        b.type = "button";
        b.append(el("span", "k", String(k + 1)), o);
        b.addEventListener("click", () => choose(k));
        opts.append(b);
      });
    } else {
      $("p-form").hidden = false;
      const inp = $("p-input");
      inp.value = ""; inp.disabled = false;
      inp.focus({ preventScroll: true });
    }
  }

  function why(e) { return e.rules.map((r) => D.rules[r]).filter(Boolean).join(" · "); }

  function result(kind, e, you) {
    answered = true;
    const r = $("p-result");
    r.className = "result " + kind;
    r.replaceChildren();
    r.append(el("div", "verdict", kind === "ok" ? "Giusto!" : kind === "close" ? "Quasi: check the accents" : "Sbagliato"));
    if (kind !== "ok" || e.a.length > 1) r.append(el("div", "ans", e.a.join(" / ")));
    if (e.full) r.append(el("div", "full", e.full));
    r.append(el("div", "why", why(e)));
    const next = el("button", "", i + 1 < qs.length ? "Next" : "Finish");
    next.type = "button";
    next.append(el("kbd", "", "Enter"));
    next.addEventListener("click", advance);
    r.append(next);
    r.hidden = false;
    if (kind === "ok" || kind === "close") right++;
    else missed.push({ q: e.q, a: e.a[0], you });
    $("p-score").textContent = right + " right";
    if (D.kind === "type") next.focus({ preventScroll: true });
  }

  function choose(k) {
    const e = qs[i];
    if (answered || D.kind !== "choice") return;
    const btns = Array.from($("p-opts").children);
    const ok = e.a.includes(e.shown[k]);
    for (const b of btns) b.disabled = true;
    btns[e.shown.indexOf(e.a[0])].classList.add("ok");
    if (!ok) btns[k].classList.add("no");
    result(ok ? "ok" : "no", e, e.shown[k]);
  }

  function check() {
    const e = qs[i];
    const you = $("p-input").value;
    if (answered || !you.trim()) return;
    $("p-input").disabled = true;
    // A subject pronoun in front is fine: "noi cerchiamo".
    const strip = (s) => norm(s).replace(/^(io|tu|lui|lei|noi|voi|loro) /, "");
    const exact = e.a.some((a) => norm(a) === norm(you) || norm(a) === strip(you));
    const close = !exact && e.a.some((a) => bare(a) === bare(you) || bare(a) === bare(strip(you)));
    result(exact ? "ok" : close ? "close" : "no", e, you.trim());
  }

  function advance() {
    if (!answered) return;
    if (D.kind === "type") $("p-form").hidden = true;
    i++;
    if (i < qs.length) return show();
    end();
  }

  function end() {
    $("p-play").hidden = true; $("p-over").hidden = false;
    $("p-final").textContent = right + " / " + qs.length + (right === qs.length ? " · Perfetto!" : "");
    const box = $("p-missed");
    box.replaceChildren();
    if (missed.length) {
      box.append(el("p", "sub", "To look at again:"));
      const ul = el("ul");
      for (const m of missed) {
        const li = el("li");
        li.append(el("span", "q2", m.q), el("span", "a2", m.a));
        if (m.you) li.append(el("span", "you", m.you));
        ul.append(li);
      }
      box.append(ul);
    }
    const b = readBest();
    if (!b || right / qs.length > b.right / b.of) {
      try { localStorage.setItem(KEY, JSON.stringify({ right, of: qs.length })); } catch (e) {}
    }
    showBest();
    $("p-again").focus({ preventScroll: true });
  }

  $("p-start").addEventListener("click", start);
  $("p-again").addEventListener("click", start);
  $("p-form").addEventListener("submit", (ev) => { ev.preventDefault(); check(); });
  for (const b of document.querySelectorAll(".accents button")) {
    b.addEventListener("mousedown", (ev) => ev.preventDefault());
    b.addEventListener("click", () => {
      const inp = $("p-input");
      if (inp.disabled) return;
      const s = inp.selectionStart ?? inp.value.length, t = inp.selectionEnd ?? s;
      inp.value = inp.value.slice(0, s) + b.dataset.ch + inp.value.slice(t);
      inp.setSelectionRange(s + 1, s + 1);
      inp.focus();
    });
  }
  document.addEventListener("keydown", (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const playing = !$("p-play").hidden;
    if (playing && D.kind === "choice" && !answered && /^[1-4]$/.test(ev.key)) { ev.preventDefault(); return choose(Number(ev.key) - 1); }
    if (ev.key !== "Enter") return;
    if (playing && answered) { ev.preventDefault(); return advance(); }
    if (!playing && !(ev.target instanceof HTMLButtonElement) && !(ev.target instanceof HTMLAnchorElement)) { ev.preventDefault(); start(); }
  });
  showBest();
})();
`;

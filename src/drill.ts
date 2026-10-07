// The Drill page: a SuperMemo 98 style review on the screen. Each due word is
// shown as its English prompt; you recall the Italian, show the answer and
// grade yourself 0–5 (Null, Bad, Fail, Pass, Good, Bright). Grades go through
// the same SM-2 scheduling as the voice drill. Words graded below Good then
// come back in a Final drill, repeated until they are Good, which (as in
// SuperMemo) doesn't change the schedule.

import { esc, nav, PAGE_CSS } from "./page.js";
import { shortDate } from "./stats.js";
import type { Store } from "./store.js";

export type DrillData = Awaited<ReturnType<Store["drillItems"]>>;

const GRADES: [label: string, desc: string][] = [
  ["Null", "Blackout"],
  ["Bad", "Wrong; knew it once shown"],
  ["Fail", "Wrong, but close"],
  ["Pass", "Right, with effort"],
  ["Good", "Right, after a pause"],
  ["Bright", "Instant"],
];

function gradeButtons(from: number, to: number): string {
  let out = "";
  for (let g = from; g <= to; g++) {
    const [label, desc] = GRADES[g];
    out += `<button type="button" class="g g${g}" data-g="${g}" title="${g}: ${esc(desc)}"><span class="n">${g}</span><span class="l">${label}</span><span class="d">${esc(desc)}</span><span class="iv"></span></button>`;
  }
  return out;
}

/** JSON for a <script type="application/json"> block: `<` can't close the element. */
function scriptJson(v: unknown): string {
  return JSON.stringify(v).replace(/</g, "\\u003c");
}

export function renderDrill(token: string, d: DrillData): string {
  const base = `/drill/${encodeURIComponent(token)}`;
  const t = encodeURIComponent(token);
  const empty = d.items.length === 0;
  const next = d.next
    ? `Next up: ${d.next.count} ${d.next.count === 1 ? "word" : "words"} on ${esc(shortDate(d.next.day))}.`
    : "Capture some words while you talk, or add them on the Words page.";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Italian drill</title>
<style>
${PAGE_CSS}
${DRILL_CSS}
</style></head><body><main class="drill">
${nav(token, "drill")}
<header class="top">
  <div><h1>Drill</h1><p class="sub" id="sub">${empty ? "Nothing to review right now." : "Recall the Italian, show the answer, then grade yourself."}</p></div>
  <label class="switch" title="Type each answer before showing it"><input type="checkbox" id="typing"><span class="knob" aria-hidden="true"></span>Type answers</label>
</header>

<div class="chips" aria-live="polite">
  <div class="chip"><b id="n-left">${d.items.length}</b><span>to go</span></div>
  <div class="chip"><b id="n-done">0</b><span>graded</span></div>
  <div class="chip"><b id="n-final">0</b><span>final drill</span></div>
  <div class="chip"><b id="n-pass">–</b><span>passed</span></div>
</div>
<div class="track" aria-hidden="true"><div class="fill" id="fill"></div></div>

<section id="card" class="flash" hidden aria-live="polite">
  <div class="kicker"><span id="dir">English → Italiano</span><span id="badges"></span></div>
  <div class="q" id="q"></div>
  <form id="typeform" class="typed" hidden><input id="typed" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" lang="it" placeholder="Scrivi in italiano…" aria-label="Your answer in Italian" maxlength="200"></form>
  <button type="button" id="show" class="show">Show answer <kbd>Space</kbd></button>
  <div id="ans" class="ans" hidden>
    <img id="pic" class="pic" alt="" hidden>
    <div class="a" id="a" lang="it"></div>
    <div id="cmp" class="cmp" hidden></div>
    <div id="note" class="note" hidden></div>
    <blockquote id="ex" class="ex" lang="it" hidden></blockquote>
    <blockquote id="ctx" class="ctx" lang="it" hidden></blockquote>
    <div class="grades" role="group" aria-label="Grade your answer">
      <div class="grp"><div class="cap">Forgot</div><div class="row">${gradeButtons(0, 2)}</div></div>
      <div class="grp"><div class="cap">Recalled</div><div class="row">${gradeButtons(3, 5)}</div></div>
    </div>
    <p class="keys"><kbd>0</kbd>–<kbd>5</kbd> to grade</p>
  </div>
</section>

<section id="final" class="flash panel" hidden>
  <svg class="icon" viewBox="0 0 48 48" aria-hidden="true"><path d="M38 18a15 15 0 0 0-27-3M10 30a15 15 0 0 0 27 3"/><path d="M11 7v8h8M37 41v-8h-8"/></svg>
  <h2>Final drill</h2>
  <p id="final-text"></p>
  <p class="muted small">Each comes back until you grade it Good (4) or Bright (5). As in SuperMemo, these repeats don't change the schedule.</p>
  <div class="actions"><button type="button" class="primary" id="final-go">Start final drill <kbd>Enter</kbd></button><button type="button" id="final-skip">Finish now</button></div>
</section>

<section id="done" class="flash panel" hidden>
  <div class="ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="rt" cx="60" cy="60" r="52"/><circle class="rv" id="d-ring" cx="60" cy="60" r="52"/></svg><div class="rl"><b id="d-pct">–</b><span>passed</span></div></div>
  <h2 id="d-title">Finito!</h2>
  <p id="d-sub" class="muted"></p>
  <div class="dstats">
    <div><b id="d-n">0</b><span>graded</span></div>
    <div><b id="d-avg">–</b><span>average grade</span></div>
    <div><b id="d-final">0</b><span>final drill repeats</span></div>
    <div><b id="d-time">0:00</b><span>time</span></div>
  </div>
  <div class="hist" id="d-hist" aria-label="Grades given"></div>
  <div class="actions"><a class="btn primary" id="d-more" href="${base}" hidden></a><a class="btn" href="/stats/${t}">See progress</a><a class="btn" href="/items/${t}">Words</a></div>
</section>

<section id="empty" class="flash panel"${empty ? "" : " hidden"}>
  <svg class="icon ok" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="19"/><path d="M15 24.5l6 6 12-13"/></svg>
  <h2>Tutto fatto!</h2>
  <p class="muted">Nothing is due today. ${next}</p>
  <div class="actions"><a class="btn" href="/stats/${t}">See progress</a><a class="btn" href="/items/${t}">Words</a></div>
</section>
</main>
<div id="toast" role="alert" hidden></div>
<script type="application/json" id="data">${scriptJson({ post: `${base}/grade`, pics: `/pic/${t}/`, due: d.due, items: d.items })}</script>
<script>${CLIENT_JS}</script>
</body></html>`;
}

const DRILL_CSS = `:root{--it-green:#009246;--it-white:#f1f2ec;--it-red:#ce2b37;--ans:#0b6b35;--shadow:rgba(20,20,10,.16);
--g0:#a8201a;--g1:#d03b3b;--g2:#e0752d;--g3:#c08f00;--g4:#2f9e57;--g5:#11804a}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--it-white:#d9dad3;--ans:#6fd59a;--shadow:rgba(0,0,0,.5);
--g0:#f0716a;--g1:#e88a6a;--g2:#f0a35c;--g3:#e5c14a;--g4:#58c785;--g5:#2fd28a}}
:root[data-theme="dark"]{--it-white:#d9dad3;--ans:#6fd59a;--shadow:rgba(0,0,0,.5);
--g0:#f0716a;--g1:#e88a6a;--g2:#f0a35c;--g3:#e5c14a;--g4:#58c785;--g5:#2fd28a}
[hidden]{display:none!important}
html{background:var(--page)}
body{min-height:100vh;background:radial-gradient(900px 420px at 50% -120px,rgba(0,146,70,.08),transparent 70%) no-repeat,var(--page)}
main.drill{max-width:720px}
.top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}
.top .sub{margin-bottom:0}
kbd{font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;border:1px solid currentColor;border-radius:5px;padding:2px 5px;opacity:.6;margin-left:6px}
@media (hover:none){kbd,.keys{display:none}}
.switch{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:var(--ink2);cursor:pointer;user-select:none}
.switch input{position:absolute;opacity:0;pointer-events:none}
.knob{width:34px;height:20px;border-radius:10px;background:var(--base);position:relative;transition:background .2s}
.knob::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3);transition:transform .2s}
.switch input:checked+.knob{background:var(--it-green)}.switch input:checked+.knob::after{transform:translateX(14px)}
.switch input:focus-visible+.knob{outline:2px solid var(--s1);outline-offset:2px}
.chips{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:16px 0 10px}
.chip{background:var(--surface);border:1px solid var(--ring);border-radius:12px;padding:8px 10px;display:flex;flex-direction:column}
.chip b{font-size:20px;font-variant-numeric:tabular-nums;line-height:1.2}.chip span{font-size:12px;color:var(--ink2)}
.track{height:6px;border-radius:3px;background:var(--grid);overflow:hidden;margin-bottom:18px}
.fill{height:100%;width:0;border-radius:3px;background:linear-gradient(90deg,var(--it-green),#3cbf73);transition:width .4s cubic-bezier(.2,.8,.2,1)}
.fill.final{background:linear-gradient(90deg,var(--g2),var(--g3))}
.flash{position:relative;background:var(--surface);border:1px solid var(--ring);border-radius:20px;padding:30px 24px 22px;overflow:hidden;
box-shadow:0 1px 2px rgba(0,0,0,.04),0 18px 40px -18px var(--shadow);min-height:300px;display:flex;flex-direction:column}
.flash::before{content:"";position:absolute;inset:0 0 auto 0;height:5px;background:linear-gradient(90deg,var(--it-green) 0 33.4%,var(--it-white) 33.4% 66.6%,var(--it-red) 66.6%)}
.flash.in{animation:cardIn .32s cubic-bezier(.2,.8,.2,1)}
.flash.out{animation:cardOut .18s ease-in forwards}
@keyframes cardIn{from{opacity:0;transform:translateY(14px) scale(.985)}to{opacity:1;transform:none}}
@keyframes cardOut{to{opacity:0;transform:translateX(-28px) rotate(-1deg)}}
.flash.out::after{content:"";position:absolute;inset:0;background:var(--c);opacity:.10;pointer-events:none}
.kicker{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:600}
#badges{display:contents}
.badge{letter-spacing:.02em;text-transform:none;font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--ring);color:var(--ink2);background:var(--page)}
.badge.new{color:var(--s1);border-color:var(--s1)}.badge.late{color:var(--g2);border-color:var(--g2)}.badge.final{color:var(--g3);border-color:var(--g3)}
.q{font-size:clamp(24px,5.2vw,34px);font-weight:650;line-height:1.2;margin:18px 0 22px;text-wrap:balance}
.typed{margin:-6px 0 14px}
.typed input{width:100%;font:inherit;font-size:18px;color:var(--ink);background:var(--page);border:1.5px solid var(--base);border-radius:12px;padding:12px 14px;outline:none;transition:border-color .15s,box-shadow .15s}
.typed input:focus{border-color:var(--it-green);box-shadow:0 0 0 4px rgba(0,146,70,.15)}
.show{margin-top:auto;width:100%;font:inherit;font-size:16px;font-weight:600;padding:14px;border-radius:14px;border:0;cursor:pointer;background:var(--ink);color:var(--page);transition:transform .12s,opacity .12s}
.show:hover{opacity:.9}.show:active{transform:scale(.99)}
.ans{animation:rise .3s cubic-bezier(.2,.8,.2,1)}
@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.pic{display:block;width:100%;max-height:220px;object-fit:cover;border-radius:14px;margin-top:4px;background:var(--grid)}
.pic:not([hidden])+.a{border-top:0;padding-top:12px}
.a{font-family:ui-serif,"Iowan Old Style","Palatino Linotype",Georgia,serif;font-size:clamp(30px,6.4vw,42px);line-height:1.15;color:var(--ans);padding-top:18px;border-top:1px dashed var(--base)}
.cmp{margin-top:10px;font-size:14px;padding:6px 10px;border-radius:8px;display:inline-block}
.cmp.match{color:var(--g5);background:rgba(17,128,74,.10)}.cmp.accents{color:var(--g3);background:rgba(192,143,0,.12)}.cmp.wrong{color:var(--g1);background:rgba(208,59,59,.10)}
.note{margin-top:10px;font-size:14px;color:var(--ink2)}
.ex{margin:12px 0 0;padding:8px 12px;border-left:3px solid var(--it-green);background:var(--page);border-radius:0 8px 8px 0;color:var(--ink);font-size:15px}
.ctx{margin:8px 0 0;padding:0 12px;font-style:italic;color:var(--muted);font-size:13px}
.ctx::before{content:"You said: ";font-style:normal}
.ex mark,.ctx mark{background:rgba(0,146,70,.16);color:var(--ink);border-radius:3px;padding:0 2px;font-style:normal}
.grades{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:22px}
.cap{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:600;margin:0 0 6px 2px}
.row{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.g{--c:var(--g0);font:inherit;color:var(--ink);display:flex;flex-direction:column;align-items:center;gap:3px;padding:10px 4px 9px;border-radius:14px;border:1px solid var(--ring);background:var(--surface);cursor:pointer;transition:transform .12s,background .12s,border-color .12s,box-shadow .12s}
.g1{--c:var(--g1)}.g2{--c:var(--g2)}.g3{--c:var(--g3)}.g4{--c:var(--g4)}.g5{--c:var(--g5)}
.g .n{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:var(--c);color:#fff;font-weight:700;font-size:15px}
.g .l{font-weight:650;font-size:14px}
.g .d{font-size:11px;color:var(--muted);text-align:center;line-height:1.2;min-height:2.4em}
.g .iv{font-size:12px;font-weight:650;font-variant-numeric:tabular-nums;color:var(--c)}
.g:hover{border-color:var(--c);transform:translateY(-2px);box-shadow:0 6px 16px -8px var(--c)}
.g:active{transform:translateY(0)}
.g.hint{border-color:var(--c);box-shadow:0 0 0 2px var(--c)}
.g:disabled{opacity:.5;cursor:progress;transform:none}
.keys{margin:14px 0 0;font-size:12px;color:var(--muted);text-align:center}.keys kbd{margin:0 2px}
.panel{align-items:center;text-align:center;padding-top:36px;animation:cardIn .32s cubic-bezier(.2,.8,.2,1)}
.panel h2{font-size:24px;margin:10px 0 4px}.panel p{margin:4px 0;max-width:46ch}.small{font-size:13px}
.icon{width:56px;height:56px;fill:none;stroke:var(--g3);stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.icon.ok{stroke:var(--it-green)}
.actions{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:20px}
.actions button,.btn{font:inherit;font-size:15px;color:var(--ink);text-decoration:none;background:var(--surface);border:1px solid var(--base);border-radius:12px;padding:10px 16px;cursor:pointer}
.actions .primary{background:var(--it-green);border-color:var(--it-green);color:#fff;font-weight:600}
.actions .primary kbd{opacity:.8}
.ring{position:relative;width:132px;height:132px}
.ring svg{width:100%;height:100%;transform:rotate(-90deg)}
.ring circle{fill:none;stroke-width:10}.rt{stroke:var(--grid)}
.rv{stroke:var(--it-green);stroke-linecap:round;stroke-dasharray:326.73;stroke-dashoffset:326.73;transition:stroke-dashoffset 1s cubic-bezier(.2,.8,.2,1) .15s}
.rl{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.rl b{font-size:28px;line-height:1}.rl span{font-size:12px;color:var(--ink2)}
.dstats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;width:100%;margin-top:18px}
.dstats div{display:flex;flex-direction:column;padding:8px;border-radius:12px;background:var(--page)}
.dstats b{font-size:20px;font-variant-numeric:tabular-nums}.dstats span{font-size:12px;color:var(--ink2)}
.hist{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;align-items:end;width:100%;max-width:360px;height:96px;margin-top:20px}
.hist div{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;gap:4px;font-size:11px;color:var(--ink2)}
.hist i{display:block;width:100%;border-radius:5px 5px 2px 2px;background:var(--c);min-height:3px;transition:height .6s cubic-bezier(.2,.8,.2,1)}
#toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);max-width:calc(100% - 32px);background:var(--ink);color:var(--page);padding:10px 16px;border-radius:12px;font-size:14px;box-shadow:0 8px 24px rgba(0,0,0,.25);z-index:9}
@media (max-width:560px){.flash{padding:26px 16px 16px;border-radius:16px}.grades{grid-template-columns:1fr;gap:10px}
.chips{gap:6px}.chip{padding:6px 8px}.chip b{font-size:17px}.chip span{font-size:11px}.dstats{grid-template-columns:repeat(2,1fr)}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
`;

// Client script. Kept as String.raw with no backticks or template holes, so
// regex escapes reach the browser unchanged.
const CLIENT_JS = String.raw`
(() => {
  const D = JSON.parse(document.getElementById("data").textContent);
  const $ = (id) => document.getElementById(id);
  const motion = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = matchMedia("(pointer: fine)").matches;
  const card = $("card"), typedEl = $("typed"), buttons = Array.from(document.querySelectorAll(".g"));
  const total = D.items.length, startedAt = Date.now();
  let queue = D.items.slice(), retry = [], phase = "main", cur = null, revealed = false, busy = false, typedAnswer = "";
  let finalTotal = 0;
  const st = { done: 0, passed: 0, sum: 0, hist: [0, 0, 0, 0, 0, 0], finalReps: 0 };

  let typing = false;
  try { typing = localStorage.getItem("drill.typing") === "1"; } catch (e) {}
  $("typing").checked = typing;
  $("typing").addEventListener("change", (e) => {
    typing = e.target.checked;
    try { localStorage.setItem("drill.typing", typing ? "1" : "0"); } catch (err) {}
    if (cur && !revealed) { $("typeform").hidden = !typing; if (typing) typedEl.focus(); }
  });

  const norm = (s) => s.normalize("NFC").toLowerCase().replace(/’/g, "'").replace(/[^\p{L}\p{N}']+/gu, " ").trim();
  const bare = (s) => norm(s).normalize("NFD").replace(/[̀-ͯ]/g, "");
  const days = (n) => n < 14 ? n + "d" : n < 60 ? Math.round(n / 7) + "w" : n < 365 ? Math.round(n / 30) + "mo" : (n / 365).toFixed(1) + "y";

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // An example or context sentence with every occurrence of the answer marked.
  function fillContext(box, text, word) {
    box.replaceChildren();
    const hay = text.toLowerCase(), needle = word.toLowerCase();
    let at = 0;
    for (let i = needle ? hay.indexOf(needle) : -1; i >= 0; i = hay.indexOf(needle, at)) {
      box.append(text.slice(at, i), el("mark", "", text.slice(i, i + needle.length)));
      at = i + needle.length;
    }
    box.append(text.slice(at));
  }

  function counters() {
    const left = queue.length + (cur ? 1 : 0);
    $("n-left").textContent = phase === "main" ? left : 0;
    $("n-done").textContent = st.done;
    $("n-final").textContent = phase === "main" ? retry.length : phase === "final" ? left : 0;
    $("n-pass").textContent = st.done ? Math.round(100 * st.passed / st.done) + "%" : "–";
    const fill = $("fill");
    fill.classList.toggle("final", phase === "final");
    const p = phase === "main" ? st.done / Math.max(1, total) : phase === "final" ? 1 - left / Math.max(1, finalTotal) : 1;
    fill.style.width = Math.round(100 * p) + "%";
  }

  function enter(node) {
    node.classList.remove("out", "in");
    void node.offsetWidth;
    if (motion) node.classList.add("in");
  }

  function show(item) {
    cur = item; revealed = false; typedAnswer = "";
    for (const id of ["final", "done", "empty"]) $(id).hidden = true;
    card.hidden = false;
    $("q").textContent = item.english;
    $("a").textContent = item.italian;
    // Loaded now, shown with the answer: a picture of the word would give it away.
    const pic = $("pic");
    pic.hidden = !item.pic;
    if (item.pic) pic.src = D.pics + item.id + "?v=" + item.pic;
    else pic.removeAttribute("src");
    const badges = $("badges");
    badges.replaceChildren();
    if (phase === "final") badges.append(el("span", "badge final", "final drill"));
    else {
      if (item.new) badges.append(el("span", "badge new", "new"));
      if (item.overdue > 0) badges.append(el("span", "badge late", item.overdue + (item.overdue === 1 ? " day" : " days") + " overdue"));
    }
    $("note").hidden = !item.note;
    $("note").textContent = item.note || "";
    $("ex").hidden = !item.example;
    if (item.example) fillContext($("ex"), item.example, item.italian);
    $("ctx").hidden = !item.context;
    if (item.context) fillContext($("ctx"), item.context, item.italian);
    $("cmp").hidden = true;
    $("ans").hidden = true;
    $("show").hidden = false;
    $("typeform").hidden = !typing;
    typedEl.value = "";
    for (const b of buttons) {
      const g = Number(b.dataset.g);
      b.classList.remove("hint");
      b.disabled = false;
      b.querySelector(".iv").textContent = phase === "final" ? (g >= 4 ? "done" : "again") : days(item.preview[g]);
    }
    $("sub").textContent = phase === "final"
      ? "Final drill: until each is Good (4) or better. The schedule is unchanged."
      : "Recall the Italian, show the answer, then grade yourself.";
    enter(card);
    counters();
    if (typing && finePointer) typedEl.focus();
  }

  function reveal() {
    if (!cur || revealed) return;
    revealed = true;
    typedAnswer = typing ? typedEl.value.trim() : "";
    typedEl.blur();
    $("typeform").hidden = true;
    $("show").hidden = true;
    if (typedAnswer) {
      const cmp = $("cmp");
      const kind = norm(typedAnswer) === norm(cur.italian) ? "match" : bare(typedAnswer) === bare(cur.italian) ? "accents" : "wrong";
      cmp.className = "cmp " + kind;
      cmp.textContent = kind === "match" ? "✓ Esatto! You wrote it right." : kind === "accents" ? "≈ Check the accents: you wrote “" + typedAnswer + "”" : "✗ You wrote “" + typedAnswer + "”";
      cmp.hidden = false;
      const hint = kind === "match" ? 5 : kind === "accents" ? 4 : 1;
      buttons[hint].classList.add("hint");
    }
    $("ans").hidden = false;
  }

  let toastTimer;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 6000);
  }

  async function grade(g) {
    if (!cur || !revealed || busy) return;
    busy = true;
    for (const b of buttons) b.disabled = true;
    if (phase === "main") {
      try {
        const r = await fetch(D.post, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: cur.id, grade: g, answer: typedAnswer }),
        });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || "HTTP " + r.status);
        st.done++; st.sum += body.grade; st.hist[body.grade]++;
        if (body.grade >= 3) st.passed++;
        if (body.grade < 4) retry.push(cur);
      } catch (e) {
        toast("Couldn't save that grade (" + e.message + "). Try again.");
        for (const b of buttons) b.disabled = false;
        busy = false;
        return;
      }
    } else {
      st.finalReps++;
      if (g < 4) queue.push(cur);
    }
    cur = null;
    card.style.setProperty("--c", "var(--g" + g + ")");
    if (motion) card.classList.add("out");
    setTimeout(() => { busy = false; next(); }, motion ? 170 : 0);
  }

  function panel(id) {
    card.hidden = true;
    for (const p of ["final", "done", "empty"]) $(p).hidden = p !== id;
    enter($(id));
    counters();
  }

  function next() {
    if (queue.length) return show(queue.shift());
    if (phase === "main" && retry.length) {
      phase = "final";
      queue = retry; retry = []; finalTotal = queue.length;
      $("final-text").textContent = finalTotal === 1
        ? "One word to go over once more."
        : finalTotal + " words to go over once more.";
      $("sub").textContent = "Main review done.";
      return panel("final");
    }
    finish();
  }

  function finish() {
    phase = "done"; cur = null; queue = [];
    const pct = st.done ? st.passed / st.done : 0;
    $("d-pct").textContent = st.done ? Math.round(pct * 100) + "%" : "–";
    $("d-title").textContent = !st.done ? "Finito!" : pct >= 0.9 ? "Bravissimo!" : pct >= 0.7 ? "Ben fatto!" : "Finito!";
    $("d-sub").textContent = st.done
      ? st.done + (st.done === 1 ? " word" : " words") + " reviewed. Every grade is saved and scheduled."
      : "Nothing was graded.";
    $("d-n").textContent = st.done;
    $("d-avg").textContent = st.done ? (st.sum / st.done).toFixed(1) : "–";
    $("d-final").textContent = st.finalReps;
    const secs = Math.round((Date.now() - startedAt) / 1000);
    $("d-time").textContent = Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0");
    const max = Math.max(1, ...st.hist), hist = $("d-hist");
    hist.replaceChildren();
    st.hist.forEach((n, g) => {
      const col = el("div"), bar = el("i");
      bar.style.setProperty("--c", "var(--g" + g + ")");
      bar.style.height = "0%";
      col.title = n + " graded " + g;
      col.append(el("span", "", n), bar, el("span", "", String(g)));
      hist.append(col);
      requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.height = Math.max(3, 70 * n / max) + "%"; }));
    });
    const more = D.due - st.done;
    const moreLink = $("d-more");
    moreLink.hidden = !(D.due > total && more > 0);
    moreLink.textContent = "Continue: " + more + " more due";
    $("sub").textContent = "Session complete.";
    panel("done");
    requestAnimationFrame(() => requestAnimationFrame(() => {
      $("d-ring").style.strokeDashoffset = String(326.73 * (1 - pct));
    }));
  }

  $("show").addEventListener("click", reveal);
  $("typeform").addEventListener("submit", (e) => { e.preventDefault(); reveal(); });
  for (const b of buttons) b.addEventListener("click", () => grade(Number(b.dataset.g)));
  $("final-go").addEventListener("click", () => next());
  $("final-skip").addEventListener("click", finish);

  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t === typedEl || t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
    if (t instanceof HTMLButtonElement && (e.key === "Enter" || e.key === " ")) return;
    if (!$("final").hidden) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); next(); }
      return;
    }
    if (!cur) return;
    if (!revealed) {
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); reveal(); }
      else if (typing && e.key.length === 1) typedEl.focus();
      return;
    }
    if (/^[0-5]$/.test(e.key)) { e.preventDefault(); grade(Number(e.key)); }
  });

  if (total) show(queue.shift());
})();
`;

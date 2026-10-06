// Lampo: a 60-second game with your own words at /game/<token>.
//
// Each round shows a prompt and four answers; tap the right one. Rounds mix
// four kinds: English → Italian, Italian → English, a photo → Italian, and
// "trappola" (trap): pick the right spelling of a word among look-alikes made
// from the mistakes Italian learners make (wrong article, wrong ending, a
// doubled or single consonant, a missing accent, c/ch and g/gh).
//
// A streak raises the multiplier; a wrong answer costs 3 seconds. Picking from
// four is recognition, much easier than the recall the drills ask for, so the
// game never touches the SM-2 schedule. Instead, the end screen offers to put
// the missed words into today's drill.

import { esc, nav, PAGE_CSS } from "./page.js";
import type { Store } from "./store.js";

export type GameData = Awaited<ReturnType<Store["gameItems"]>>;

/** Fewer words than this and there's nothing to choose between. */
export const GAME_MIN_WORDS = 4;

const ARTICLES: Record<string, string[]> = {
  il: ["lo", "la"],
  lo: ["il", "la"],
  la: ["il", "lo"],
  i: ["gli", "le"],
  gli: ["i", "le"],
  le: ["i", "gli"],
  un: ["uno", "una"],
  uno: ["un", "una"],
  una: ["un", "uno"],
};
const ENDINGS: Record<string, string> = { o: "a", a: "o", e: "i", i: "e" };
const VOWEL = "aeiouàèéìíòóùú";

const sameCase = (word: string, like: string) => (like[0] === like[0].toUpperCase() ? word[0].toUpperCase() + word.slice(1) : word);

/**
 * Wrong look-alikes of `italian` for a trap round, at most 8. `taken` holds
 * every word in the list (lower-cased): a look-alike that is itself one of
 * your words would be a right answer, so it's left out.
 *
 * Changing the ending only happens next to a gendered article: on a bare
 * adjective ("stanco") the other ending ("stanca") is just as right.
 */
export function traps(italian: string, taken: Set<string> = new Set()): string[] {
  const s = italian.trim().replace(/\s+/g, " ");
  const words = s.split(" ");
  if (!s || words.length > 4) return [];
  const out = new Set<string>();
  const add = (v: string) => {
    const k = v.toLowerCase();
    if (k !== s.toLowerCase() && !taken.has(k)) out.add(v);
  };

  // Article: il ↔ lo ↔ la, i ↔ gli ↔ le, un ↔ uno ↔ una, l' → lo / la.
  const art = words[0].toLowerCase();
  const article = words.length > 1 && art in ARTICLES;
  if (article) for (const a of ARTICLES[art]) add([sameCase(a, words[0]), ...words.slice(1)].join(" "));
  const elided = s.match(/^([Ll])['’](\S.*)$/);
  if (elided) for (const a of ["o", "a"]) add(`${elided[1]}${a} ${elided[2]}`);

  // Ending of the noun, so it no longer agrees with its article. Not after
  // l', which has no gender: l'amica and l'amico are both right.
  const last = words[words.length - 1];
  const end = last.match(/^(.*[a-zà-ù]{2})([oaei])$/i);
  if (article && end) add([...words.slice(0, -1), end[1] + ENDINGS[end[2].toLowerCase()]].join(" "));

  // Double consonants: drop one of a pair, or double a single one between vowels.
  for (const m of s.matchAll(/([bcdfglmnprstvz])\1/gi)) add(s.slice(0, m.index) + s.slice(m.index! + 1));
  const single = new RegExp(`(?<=[${VOWEL}])([bcdfglmnprstvz])(?=[${VOWEL}])`, "gi");
  for (const m of s.matchAll(single)) {
    if (article && m.index! < words[0].length) continue;
    add(s.slice(0, m.index! + 1) + m[1] + s.slice(m.index! + 1));
  }

  // Accents: dropped, or the other one (perché → perche, perchè).
  if (/[àèéìíòóùú]/i.test(s)) {
    add(s.normalize("NFD").replace(/[̀-ͯ]/g, ""));
    add(s.replace(/[éè]/g, (c) => (c === "é" ? "è" : "é")));
  }

  // Spelling of sounds: ch/c and gh/g before e/i, gli/li, gn/ni.
  add(s.replace(/ch(?=[eiéèì])/i, "c"));
  add(s.replace(/(?<![cs])c(?=[eiéèì])/i, "ch"));
  add(s.replace(/gh(?=[eiéèì])/i, "g"));
  add(s.replace(/(?<!g)g(?=[eiéèì])/i, "gh"));
  add(s.replace(/gli/i, "li"));
  add(s.replace(/gn/i, "ni"));

  return [...out].slice(0, 8);
}

/** JSON for a <script type="application/json"> block: `<` can't close the element. */
function scriptJson(v: unknown): string {
  return JSON.stringify(v).replace(/</g, "\\u003c");
}

export function renderGame(token: string, d: GameData): string {
  const t = encodeURIComponent(token);
  const base = `/game/${t}`;
  const taken = new Set(d.items.map((i) => i.italian.trim().toLowerCase()));
  const items = d.items.map((i) => ({
    id: i.id,
    it: i.italian,
    en: i.english,
    pic: i.pic,
    // Harder, more often: low ease, past failures and anything due today.
    w: Math.round((1 + 2 * Math.max(0, 2.5 - i.ease) + 0.5 * Math.min(i.lapses, 6) + (i.due ? 1 : 0)) * 100) / 100,
    traps: traps(i.italian, taken),
  }));
  const playable = items.length >= GAME_MIN_WORDS;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Lampo</title>
<style>
${PAGE_CSS}
${GAME_CSS}
</style></head><body><main class="game">
${nav(token, "game")}

<section id="intro" class="stage panel">
  <svg class="bolt" viewBox="0 0 48 48" aria-hidden="true"><path d="M27 4 9 27h13l-3 17 20-25H26z"/></svg>
  <h1>Lampo</h1>
  <p class="lead">60 seconds. Four answers. Tap the right one.</p>
  <ul class="rules">
    <li><b>Streak</b> 3 in a row doubles your points, 6 triples them, 10 quadruples them.</li>
    <li><b>Miss</b> and you lose 3 seconds and the streak.</li>
    <li><b>Trappola</b> rounds hide the word among look-alikes: wrong article, wrong ending, one consonant too many or too few, a lost accent.</li>
  </ul>
  ${
    playable
      ? `<p class="best">${d.plays ? `Best <b>${d.best}</b> · ${d.plays} ${d.plays === 1 ? "round" : "rounds"} played` : "First round: set a score to beat."}</p>
  <div class="actions"><button type="button" class="primary" id="start">Start <kbd>Enter</kbd></button></div>
  <p class="muted small">Your answers here don't change when words are due.</p>`
      : `<p class="muted">The game needs at least ${GAME_MIN_WORDS} words; you have ${items.length}. Capture some while you talk, or add them on the <a href="/items/${t}">Words page</a>.</p>`
  }
</section>

<section id="play" hidden>
  <div class="hud">
    <div class="score"><b id="score">0</b><span>points</span></div>
    <div class="combo" id="combo" aria-live="polite"></div>
    <div class="clock"><b id="secs">60</b><span>seconds</span></div>
  </div>
  <div class="timebar" aria-hidden="true"><div id="timefill"></div></div>
  <div class="stage round" id="round">
    <div class="kicker" id="kind"></div>
    <img id="pic" class="pic" alt="" hidden>
    <div class="q" id="q"></div>
    <div class="opts" id="opts" role="group" aria-label="Answers"></div>
    <div class="pop" id="pop" aria-hidden="true"></div>
  </div>
</section>

<section id="over" class="stage panel" hidden>
  <div class="kicker">Tempo scaduto</div>
  <div class="final"><b id="o-score">0</b><span>points</span></div>
  <p id="o-record" class="record" hidden>Nuovo record!</p>
  <p id="o-best" class="muted"></p>
  <div class="ostats">
    <div><b id="o-right">0</b><span>right</span></div>
    <div><b id="o-acc">–</b><span>accuracy</span></div>
    <div><b id="o-streak">0</b><span>best streak</span></div>
  </div>
  <div id="o-missed" class="missed" hidden>
    <h2>Missed</h2>
    <ul id="o-list"></ul>
    <button type="button" id="o-due">Drill these today</button>
  </div>
  <div class="actions"><button type="button" class="primary" id="again">Play again <kbd>Enter</kbd></button><a class="btn" href="/drill/${t}">Drill</a></div>
</section>
</main>
<div id="toast" role="alert" hidden></div>
<script type="application/json" id="data">${scriptJson({ score: `${base}/score`, due: `${base}/due`, pics: `/pic/${t}/`, best: d.best, items: playable ? items : [] })}</script>
<script>${CLIENT_JS}</script>
</body></html>`;
}

const GAME_CSS = `:root{--it-green:#009246;--it-white:#f1f2ec;--it-red:#ce2b37;--ok:#11804a;--no:#c22f2f;--gold:#b98300;--shadow:rgba(20,20,10,.16)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--it-white:#d9dad3;--ok:#2fd28a;--no:#f0716a;--gold:#e5c14a;--shadow:rgba(0,0,0,.5)}}
:root[data-theme="dark"]{--it-white:#d9dad3;--ok:#2fd28a;--no:#f0716a;--gold:#e5c14a;--shadow:rgba(0,0,0,.5)}
[hidden]{display:none!important}
body{min-height:100vh;background:radial-gradient(900px 420px at 50% -120px,rgba(0,146,70,.08),transparent 70%) no-repeat,var(--page)}
main.game{max-width:640px}
kbd{font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;border:1px solid currentColor;border-radius:5px;padding:2px 5px;opacity:.6;margin-left:6px}
@media (hover:none){kbd{display:none}}
.stage{position:relative;background:var(--surface);border:1px solid var(--ring);border-radius:20px;padding:28px 22px 22px;overflow:hidden;
box-shadow:0 1px 2px rgba(0,0,0,.04),0 18px 40px -18px var(--shadow)}
.stage::before{content:"";position:absolute;inset:0 0 auto 0;height:5px;background:linear-gradient(90deg,var(--it-green) 0 33.4%,var(--it-white) 33.4% 66.6%,var(--it-red) 66.6%)}
.panel{text-align:center;display:flex;flex-direction:column;align-items:center;animation:in .32s cubic-bezier(.2,.8,.2,1)}
.panel h1{font-size:34px;margin:6px 0 2px;letter-spacing:-.01em}
.lead{font-size:17px;margin:0 0 14px}
.bolt{width:56px;height:56px;fill:var(--gold)}
.rules{list-style:none;padding:0;margin:4px 0 16px;text-align:left;max-width:46ch;font-size:14px;color:var(--ink2)}
.rules li{padding:6px 0;border-top:1px solid var(--grid)}.rules li:first-child{border-top:0}.rules b{color:var(--ink)}
.best{margin:4px 0}.small{font-size:13px}
.actions{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:16px}
.actions button,.btn,#o-due{font:inherit;font-size:15px;color:var(--ink);text-decoration:none;background:var(--surface);border:1px solid var(--base);border-radius:12px;padding:10px 18px;cursor:pointer}
.actions .primary{background:var(--it-green);border-color:var(--it-green);color:#fff;font-weight:600;font-size:17px;padding:12px 26px}
.actions .primary kbd{opacity:.8}
.hud{display:grid;grid-template-columns:1fr auto 1fr;align-items:end;gap:8px;margin:6px 0 8px}
.score,.clock{display:flex;flex-direction:column}.clock{align-items:flex-end}
.score b,.clock b{font-size:32px;line-height:1;font-variant-numeric:tabular-nums}.score span,.clock span{font-size:12px;color:var(--ink2)}
.clock.low b{color:var(--no)}
.combo{font-weight:700;font-size:15px;color:var(--gold);min-height:1.4em;text-align:center}
.combo.up{animation:pulse .35s ease-out}
.timebar{height:8px;border-radius:4px;background:var(--grid);overflow:hidden;margin-bottom:16px}
#timefill{height:100%;width:100%;border-radius:4px;background:linear-gradient(90deg,var(--it-green),#3cbf73);transform-origin:left;will-change:transform}
#timefill.low{background:linear-gradient(90deg,var(--it-red),#e8604f)}
.round{min-height:340px;display:flex;flex-direction:column}
.round.shake{animation:shake .35s}
.kicker{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:600}
.kicker.trap{color:var(--gold)}
.pic{display:block;width:100%;max-height:200px;object-fit:cover;border-radius:14px;margin-top:12px;background:var(--grid)}
.q{font-size:clamp(24px,5.4vw,32px);font-weight:650;line-height:1.2;margin:14px 0 20px;text-wrap:balance}
.q[lang=it]{font-family:ui-serif,"Iowan Old Style","Palatino Linotype",Georgia,serif;font-weight:500}
.opts{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:auto}
.opt{position:relative;font:inherit;font-size:17px;color:var(--ink);text-align:left;background:var(--page);border:1.5px solid var(--base);border-radius:14px;padding:14px 14px 14px 42px;cursor:pointer;min-height:58px;
transition:transform .1s,border-color .12s,background .12s}
.opt[lang=it]{font-family:ui-serif,"Iowan Old Style","Palatino Linotype",Georgia,serif;font-size:19px}
.opt .k{position:absolute;left:12px;top:50%;transform:translateY(-50%);width:20px;height:20px;border-radius:6px;border:1px solid var(--base);display:grid;place-items:center;font:600 11px/1 system-ui,sans-serif;color:var(--muted)}
.opt:hover{border-color:var(--ink2)}.opt:active{transform:scale(.985)}
.opt.ok{border-color:var(--ok);background:color-mix(in srgb,var(--ok) 14%,var(--page))}
.opt.ok .k{background:var(--ok);border-color:var(--ok);color:#fff}
.opt.no{border-color:var(--no);background:color-mix(in srgb,var(--no) 12%,var(--page));text-decoration:line-through;text-decoration-color:var(--no)}
.opt.no .k{background:var(--no);border-color:var(--no);color:#fff}
.opt:disabled{cursor:default}.opt:disabled:not(.ok):not(.no){opacity:.55}
.round.in .opt{animation:in .26s cubic-bezier(.2,.8,.2,1) backwards}
.round.in .opt:nth-child(2){animation-delay:.03s}.round.in .opt:nth-child(3){animation-delay:.06s}.round.in .opt:nth-child(4){animation-delay:.09s}
.pop{position:absolute;right:20px;top:18px;font-weight:800;font-size:22px;color:var(--ok);opacity:0;pointer-events:none}
.pop.go{animation:pop .7s ease-out}.pop.minus{color:var(--no)}
.final{display:flex;flex-direction:column;margin:10px 0 2px}.final b{font-size:64px;line-height:1;font-variant-numeric:tabular-nums}.final span{color:var(--ink2);font-size:13px}
.record{font-weight:800;font-size:20px;color:var(--gold);margin:8px 0 0;animation:pulse .6s ease-out 2}
.ostats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;width:100%;margin-top:16px}
.ostats div{display:flex;flex-direction:column;padding:10px;border-radius:12px;background:var(--page)}
.ostats b{font-size:22px;font-variant-numeric:tabular-nums}.ostats span{font-size:12px;color:var(--ink2)}
.missed{width:100%;text-align:left;margin-top:18px}
.missed ul{list-style:none;padding:0;margin:6px 0 12px;font-size:15px}
.missed li{display:flex;flex-wrap:wrap;gap:4px 10px;padding:7px 0;border-top:1px solid var(--grid)}
.missed .it{font-family:ui-serif,"Iowan Old Style","Palatino Linotype",Georgia,serif;font-size:17px;color:var(--ok)}
.missed .en{color:var(--ink2)}.missed .you{color:var(--no);text-decoration:line-through;font-size:14px}
#toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);max-width:calc(100% - 32px);background:var(--ink);color:var(--page);padding:10px 16px;border-radius:12px;font-size:14px;box-shadow:0 8px 24px rgba(0,0,0,.25);z-index:9}
@keyframes in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes pulse{0%{transform:scale(1)}40%{transform:scale(1.25)}100%{transform:scale(1)}}
@keyframes pop{0%{opacity:0;transform:translateY(6px)}20%{opacity:1}100%{opacity:0;transform:translateY(-26px)}}
@keyframes shake{20%,60%{transform:translateX(-6px)}40%,80%{transform:translateX(6px)}}
@media (max-width:480px){.stage{padding:24px 14px 16px;border-radius:16px}.opts{grid-template-columns:1fr}.opt{min-height:52px}.round{min-height:0}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
`;

// Client script. Kept as String.raw with no backticks or template holes, so
// regex escapes reach the browser unchanged.
const CLIENT_JS = String.raw`
(() => {
  const D = JSON.parse(document.getElementById("data").textContent);
  const $ = (id) => document.getElementById(id);
  const motion = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ROUND_MS = 60000, PENALTY_MS = 3000, BASE = 10;
  const words = D.items;
  if (!words.length) return;

  let st, cur, endAt, raf, locked = false, recent = [];

  const mult = (streak) => streak >= 10 ? 4 : streak >= 6 ? 3 : streak >= 3 ? 2 : 1;
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const sample = (a) => a[Math.floor(Math.random() * a.length)];
  const lc = (s) => s.trim().toLowerCase();
  const firstWord = (s) => lc(s).split(/\s+/)[0];

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // Weighted toward hard words, never one of the last few shown.
  function pickWord() {
    const pool = words.filter((w) => !recent.includes(w.id));
    const from = pool.length ? pool : words;
    let r = Math.random() * from.reduce((a, w) => a + w.w, 0);
    for (const w of from) { r -= w.w; if (r <= 0) return w; }
    return from[from.length - 1];
  }

  // Three other words, the most alike first (same article, similar length), so
  // the answer can't be spotted by its shape.
  function distractors(w, field) {
    const seen = new Set([lc(w[field])]);
    const ranked = shuffle(words.filter((o) => o.id !== w.id)).map((o) => ({
      v: o[field],
      s: (firstWord(o.it) === firstWord(w.it) ? 2 : 0) + (Math.abs(o[field].length - w[field].length) <= 3 ? 1 : 0) + Math.random(),
    })).sort((a, b) => b.s - a.s);
    const out = [];
    for (const r of ranked) {
      if (out.length === 3) break;
      if (seen.has(lc(r.v))) continue;
      seen.add(lc(r.v)); out.push(r.v);
    }
    return out;
  }

  function makeRound(w) {
    const kinds = ["en-it", "en-it", "it-en"];
    if (w.traps.length >= 3) kinds.push("trap", "trap");
    if (w.pic) kinds.push("pic");
    let kind = sample(kinds);
    let others = kind === "trap" ? shuffle(w.traps.slice()).slice(0, 3) : distractors(w, kind === "it-en" ? "en" : "it");
    if (others.length < 3 && kind !== "trap") return null;
    const answer = kind === "it-en" ? w.en : w.it;
    return { w, kind, answer, options: shuffle([answer, ...others]) };
  }

  function show() {
    let r = null;
    for (let tries = 0; !r && tries < 20; tries++) r = makeRound(pickWord());
    if (!r) return end();
    cur = r; locked = false;
    recent.push(r.w.id);
    if (recent.length > Math.min(6, words.length - 1)) recent.shift();
    const k = $("kind");
    k.className = "kicker" + (r.kind === "trap" ? " trap" : "");
    k.textContent = { "en-it": "In italiano?", "it-en": "What does it mean?", "pic": "Cos'è?", "trap": "Trappola: which is right?" }[r.kind];
    const pic = $("pic");
    pic.hidden = r.kind !== "pic";
    if (r.kind === "pic") pic.src = D.pics + r.w.id + "?v=" + r.w.pic;
    const q = $("q");
    q.hidden = r.kind === "pic";
    q.textContent = r.kind === "it-en" ? r.w.it : r.w.en;
    if (r.kind === "it-en") q.setAttribute("lang", "it"); else q.removeAttribute("lang");
    const opts = $("opts");
    opts.replaceChildren();
    r.options.forEach((o, i) => {
      const b = el("button", "opt");
      b.type = "button";
      if (r.kind !== "it-en") b.setAttribute("lang", "it");
      b.append(el("span", "k", String(i + 1)), o);
      b.addEventListener("click", () => choose(i));
      opts.append(b);
    });
    const round = $("round");
    round.classList.remove("in", "shake");
    void round.offsetWidth;
    if (motion) round.classList.add("in");
  }

  function pop(text, minus) {
    const p = $("pop");
    p.textContent = text;
    p.className = "pop" + (minus ? " minus" : "");
    void p.offsetWidth;
    p.classList.add("go");
  }

  function hud() {
    $("score").textContent = st.score;
    const m = mult(st.streak), c = $("combo");
    const text = m > 1 ? "×" + m + " · " + st.streak + " in a row" : st.streak ? st.streak + " in a row" : "";
    if (m > mult(st.streak - 1) && st.streak) { c.classList.remove("up"); void c.offsetWidth; c.classList.add("up"); }
    c.textContent = text;
  }

  function choose(i) {
    if (locked || !cur) return;
    locked = true;
    const btns = Array.from($("opts").children);
    const right = cur.options.indexOf(cur.answer);
    for (const b of btns) b.disabled = true;
    btns[right].classList.add("ok");
    st.answered++;
    if (i === right) {
      st.correct++; st.streak++;
      st.bestStreak = Math.max(st.bestStreak, st.streak);
      const pts = BASE * mult(st.streak);
      st.score += pts;
      pop("+" + pts);
      hud();
      setTimeout(show, motion ? 380 : 120);
    } else {
      btns[i].classList.add("no");
      st.streak = 0;
      endAt -= PENALTY_MS;
      pop("−3 s", true);
      if (motion) $("round").classList.add("shake");
      if (!st.missed.some((m) => m.id === cur.w.id)) st.missed.push({ id: cur.w.id, it: cur.w.it, en: cur.w.en, you: cur.kind === "trap" ? cur.options[i] : "" });
      hud();
      setTimeout(show, 1300);
    }
  }

  function tick() {
    const left = Math.max(0, endAt - performance.now());
    $("secs").textContent = Math.ceil(left / 1000);
    $("timefill").style.transform = "scaleX(" + (left / ROUND_MS) + ")";
    const low = left < 10000;
    $("secs").parentElement.classList.toggle("low", low);
    $("timefill").classList.toggle("low", low);
    if (left <= 0) return end();
    raf = requestAnimationFrame(tick);
  }

  function start() {
    st = { score: 0, answered: 0, correct: 0, streak: 0, bestStreak: 0, missed: [] };
    recent = [];
    $("intro").hidden = true; $("over").hidden = true; $("play").hidden = false;
    hud();
    endAt = performance.now() + ROUND_MS;
    show();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  }

  let toastTimer;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
  }

  async function post(url, body) {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
    return j;
  }

  async function end() {
    cancelAnimationFrame(raf);
    cur = null; locked = true;
    $("play").hidden = true; $("over").hidden = false;
    $("o-score").textContent = st.score;
    $("o-right").textContent = st.correct;
    $("o-acc").textContent = st.answered ? Math.round(100 * st.correct / st.answered) + "%" : "–";
    $("o-streak").textContent = st.bestStreak;
    $("o-record").hidden = true;
    $("o-best").textContent = "";
    const list = $("o-list");
    list.replaceChildren();
    for (const m of st.missed) {
      const li = el("li");
      li.append(el("span", "it", m.it), el("span", "en", m.en));
      if (m.you) li.append(el("span", "you", m.you));
      list.append(li);
    }
    $("o-missed").hidden = !st.missed.length;
    const due = $("o-due");
    due.disabled = false;
    due.textContent = st.missed.length === 1 ? "Drill this one today" : "Drill these " + st.missed.length + " today";
    $("again").focus({ preventScroll: true });
    try {
      const r = await post(D.score, { score: st.score, answered: st.answered, correct: st.correct, streak: st.bestStreak });
      $("o-record").hidden = !r.record;
      $("o-best").textContent = r.record ? (r.previous ? "Previous best " + r.previous + "." : "") : "Best " + r.best + ".";
      $("o-best").hidden = !$("o-best").textContent;
    } catch (e) {
      toast("Couldn't save the score (" + e.message + ").");
    }
  }

  $("start").addEventListener("click", start);
  $("again").addEventListener("click", start);
  $("o-due").addEventListener("click", async () => {
    const b = $("o-due");
    b.disabled = true;
    try {
      const r = await post(D.due, { ids: st.missed.map((m) => m.id) });
      b.textContent = r.count === 1 ? "1 word is in today's drill" : r.count + " words are in today's drill";
    } catch (e) {
      b.disabled = false;
      toast("Couldn't add them (" + e.message + ").");
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!$("play").hidden) {
      if (/^[1-4]$/.test(e.key)) { e.preventDefault(); choose(Number(e.key) - 1); }
      return;
    }
    if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLAnchorElement)) {
      e.preventDefault(); start();
    }
  });
})();
`;

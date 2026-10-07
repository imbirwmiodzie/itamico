// Il Palazzo: a 3D memory palace of your words at /palazzo/<token>.
//
// Walk through a library and a gallery. Every word is a book, shelved
// alphabetically by its noun (articles don't count, as in an index), so a word
// always lives in the same part of the room. The spine's colour is its
// learning stage and a tricolour ribbon marks it due today. Words with a photo
// also hang in the gallery behind the library, with the Italian on a plaque.
//
// Two ways to play: Passeggiata, a free walk where looking at a book shows its
// Italian and then its meaning; and Caccia, a hunt where the page names a
// meaning in English and you find its book. Since the shelves are in
// alphabetical order, the quick way to a book is to recall the Italian. Like
// Lampo, the hunt never changes the schedule; the words you needed help with
// can be sent to today's drill.
//
// Plain WebGL, no libraries: boxes and textured quads batched per texture, with
// lighting baked into vertex colours and distance fog in the shader. Spine and
// plaque text is drawn into canvas atlases.

import { nav, PAGE_CSS } from "./page.js";
import type { PalazzoWord } from "./store.js";

export interface PalazzoData {
  items: PalazzoWord[];
  total: number;
}

/** The gallery's length grows with its paintings; past this it gets tedious. */
export const GALLERY_MAX = 24;

/**
 * Where a word is shelved: lower-cased, without accents and without a leading
 * article ("la pellicola" → "pellicola", "l'amica" → "amica").
 */
export function shelfKey(italian: string): string {
  const s = italian.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/’/g, "'");
  const bare = s.replace(/^(il|lo|la|i|gli|le|un|uno|una)\s+(?=\S)/, "").replace(/^(l|un)'\s*(?=\S)/, "");
  return bare.replace(/^[^a-z0-9]+/, "") || s;
}

/** 0 not yet recalled, 1 learning (under a week), 2 young (1–3 weeks), 3 mature; as on the stats page. */
export function stage(w: Pick<PalazzoWord, "repetitions" | "interval_days">): 0 | 1 | 2 | 3 {
  if (w.repetitions === 0) return 0;
  return w.interval_days < 7 ? 1 : w.interval_days < 21 ? 2 : 3;
}

/** Harder, more often in the hunt: low ease, past failures and anything due today (as in Lampo). */
const weight = (w: PalazzoWord) =>
  Math.round((1 + 2 * Math.max(0, 2.5 - w.ease) + 0.5 * Math.min(w.lapses, 6) + (w.due ? 1 : 0)) * 100) / 100;

/** JSON for a <script type="application/json"> block: `<` can't close the element. */
function scriptJson(v: unknown): string {
  return JSON.stringify(v).replace(/</g, "\\u003c");
}

export function renderPalazzo(token: string, d: PalazzoData): string {
  const t = encodeURIComponent(token);
  const shelved = d.items
    .map((w) => ({ w, key: shelfKey(w.italian) }))
    .sort((a, b) => a.key.localeCompare(b.key, "it") || a.w.id - b.w.id);
  // The gallery takes the hardest words that have a photo.
  const hung = new Set(
    d.items
      .filter((w) => w.pic !== null)
      .sort((a, b) => weight(b) - weight(a) || a.id - b.id)
      .slice(0, GALLERY_MAX)
      .map((w) => w.id),
  );
  const items = shelved.map(({ w, key }) => ({
    id: w.id,
    it: w.italian,
    en: w.english,
    note: w.note,
    ctx: w.example ?? w.context,
    st: stage(w),
    iv: w.interval_days,
    due: w.due,
    w: weight(w),
    k: (key[0] ?? "?").toUpperCase(),
    pic: w.pic,
    g: hung.has(w.id),
  }));
  const n = items.length;
  const capped = d.total > n ? `<p class="small muted">The ${n} hardest and due of your ${d.total} words are on the shelves.</p>` : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>Il Palazzo</title>
<style>
${PAGE_CSS}
${PALAZZO_CSS}
</style></head><body>
<canvas id="view" tabindex="-1" aria-label="The library and gallery of your words"></canvas>

<div id="hud" hidden>
  <button type="button" class="glass hbtn" id="menu-btn" aria-label="Menu">☰ <span>Menu</span></button>
  <div id="prompt" class="glass" hidden>
    <div class="kicker">Trova <span id="h-prog"></span></div>
    <div id="h-en"></div>
    <div class="hrow"><span id="h-time">0:00</span><button type="button" id="h-hint">Aiuto <kbd>H</kbd></button><button type="button" id="h-skip">Salta <kbd>N</kbd></button></div>
  </div>
  <canvas id="map" width="150" height="150" aria-hidden="true"></canvas>
  <div id="cross" aria-hidden="true"></div>
  <div id="look" class="glass" hidden><div id="l-it" lang="it"></div><div id="l-en"></div><div id="l-tip"></div></div>
  <div id="tips" class="glass small"></div>
  <div id="stick" aria-hidden="true"><div></div></div>
</div>

<div id="card" class="sheet" role="dialog" aria-modal="true" aria-labelledby="c-it" hidden>
  <div class="kicker" id="c-stage"></div>
  <h2 id="c-it" lang="it"></h2>
  <p id="c-en"></p>
  <p id="c-note" class="muted"></p>
  <p id="c-ctx" lang="it"></p>
  <div class="actions"><button type="button" id="c-due">Drill it today</button><button type="button" class="primary" id="c-close">Close <kbd>Esc</kbd></button></div>
</div>

<main id="menu" class="sheet wide">
  ${nav(token, "palazzo")}
  <h1>Il Palazzo</h1>
  <p class="lead">Your words, in a building you can walk through.</p>
  <p>Every word is a book in the library, shelved in alphabetical order of its noun, so it always stands in the same place.${hung.size ? " Words with a photo also hang in the gallery behind the library." : ""}</p>
  ${capped}
  <ul class="legend">
    <li><i class="sw s0"></i>Not yet recalled</li>
    <li><i class="sw s1"></i>Learning</li>
    <li><i class="sw s2"></i>Young (1–3 weeks)</li>
    <li><i class="sw s3"></i>Mature (3+ weeks)</li>
    <li><i class="sw rib"></i>Ribbon: due today</li>
  </ul>
  ${
    n
      ? `<div class="actions">
    <button type="button" class="primary" data-mode="hunt"${n < 2 ? " disabled" : ""}>Caccia <span>find ${Math.min(10, n)} words</span></button>
    <button type="button" data-mode="explore">Passeggiata <span>walk and read</span></button>
    <button type="button" id="resume" hidden>Riprendi <kbd>Esc</kbd></button>
  </div>
  <p class="small muted">Caccia: the meaning is in English; find the book. The shelves are alphabetical, so recall the Italian and head for its letter. Help and wrong books cost time, and those words can go into today's drill. The game never changes when words are due.</p>`
      : `<p class="muted">The shelves are empty. Capture some words while you talk, or add them on the <a href="/items/${t}">Words page</a>.</p>`
  }
  <p class="small muted controls"><b>Move</b> W A S D or arrows, Shift to run · <b>look</b> with the mouse (click to capture it) · <b>open</b> a book with a click.<br><b>Phone:</b> left thumb walks, right thumb looks, tap a book.</p>
  <p id="nogl" class="err" hidden>This browser can't show 3D graphics (WebGL is off or unsupported).</p>
</main>

<section id="over" class="sheet wide" hidden>
  <div class="kicker">Caccia finita</div>
  <div class="final"><b id="o-time">0:00</b><span>time, with penalties</span></div>
  <p id="o-best" class="muted"></p>
  <div class="ostats"><div><b id="o-clean">0</b><span>found unaided</span></div><div><b id="o-wrong">0</b><span>wrong books</span></div><div><b id="o-hints">0</b><span>help or skips</span></div></div>
  <div id="o-missed" class="missed" hidden><h2>Needed help</h2><ul id="o-list"></ul><button type="button" id="o-due">Drill these today</button></div>
  <div class="actions"><button type="button" class="primary" data-mode="hunt">Again</button><button type="button" data-mode="explore">Walk around</button><a class="btn" href="/drill/${t}">Drill</a></div>
</section>

<div id="toast" role="status" hidden></div>
<script type="application/json" id="data">${scriptJson({ due: `/palazzo/${t}/due`, pics: `/pic/${t}/`, items })}</script>
<script>${CLIENT_JS}</script>
</body></html>`;
}

// The scene is a library at night whatever the theme; menus follow the theme.
const PALAZZO_CSS = `:root{--it-green:#009246;--it-red:#ce2b37;--gold:#b98300;--glass:rgba(22,16,11,.74);--gink:#f4ecdc;--gmut:#c9bba3}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--gold:#e5c14a}}
:root[data-theme="dark"]{--gold:#e5c14a}
[hidden]{display:none!important}
html,body{height:100%;overflow:hidden;overscroll-behavior:none}
body{background:#120c08}
#view{position:fixed;inset:0;width:100%;height:100%;display:block;touch-action:none;outline:none;cursor:crosshair}
kbd{font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;border:1px solid currentColor;border-radius:5px;padding:2px 5px;opacity:.6;margin-left:6px}
@media (hover:none){kbd{display:none}}
.small{font-size:13px}
.kicker{font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:600;color:var(--muted)}
.sheet{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,calc(100% - 32px));max-height:calc(100% - 32px);overflow:auto;
background:var(--surface);color:var(--ink);border:1px solid var(--ring);border-radius:20px;padding:22px 22px 18px;box-shadow:0 24px 60px rgba(0,0,0,.5);z-index:5}
.sheet::before{content:"";position:absolute;inset:0 0 auto 0;height:5px;border-radius:20px 20px 0 0;background:linear-gradient(90deg,var(--it-green) 0 33.4%,#f1f2ec 33.4% 66.6%,var(--it-red) 66.6%)}
.sheet.wide{width:min(640px,calc(100% - 32px))}
.sheet h1{font-size:30px;margin:4px 0 2px;font-family:ui-serif,"Iowan Old Style","Palatino Linotype",Georgia,serif;font-weight:600}
.sheet p{margin:8px 0}.lead{font-size:17px;color:var(--ink2)}
.legend{list-style:none;padding:0;margin:10px 0;display:flex;flex-wrap:wrap;gap:6px 16px;font-size:13px;color:var(--ink2)}
.legend li{display:flex;align-items:center;gap:6px}
.sw{display:inline-block;width:12px;height:22px;border-radius:2px;box-shadow:inset -3px 0 0 rgba(0,0,0,.25)}
.s0{background:#dccfae}.s1{background:#7a1f1f}.s2{background:#1f4d33}.s3{background:#1b2f55}
.sw.rib{width:9px;background:linear-gradient(90deg,var(--it-green) 0 33%,#f1f2ec 33% 66%,var(--it-red) 66%);clip-path:polygon(0 0,100% 0,100% 100%,50% 78%,0 100%);box-shadow:none}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.actions button,.btn,#o-due,#c-due{font:inherit;font-size:15px;color:var(--ink);text-decoration:none;background:var(--surface);border:1px solid var(--base);border-radius:12px;padding:10px 16px;cursor:pointer;display:inline-flex;align-items:baseline;gap:6px}
.actions button span{font-size:13px;color:var(--ink2)}
.actions .primary{background:var(--it-green);border-color:var(--it-green);color:#fff;font-weight:600}
.actions .primary span{color:rgba(255,255,255,.85)}
.actions button:disabled{opacity:.5;cursor:default}
.err{color:var(--bad);font-weight:600}
.glass{background:var(--glass);color:var(--gink);border:1px solid rgba(255,236,200,.14);border-radius:14px;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
#hud{position:fixed;inset:0;pointer-events:none;z-index:2;font-size:15px}
#hud button{pointer-events:auto;font:inherit;cursor:pointer}
.hbtn{position:absolute;left:max(12px,env(safe-area-inset-left));top:max(12px,env(safe-area-inset-top));padding:8px 12px;font-size:14px}
#prompt{position:absolute;left:50%;top:max(12px,env(safe-area-inset-top));transform:translateX(-50%);min-width:220px;max-width:min(520px,calc(100% - 210px));padding:9px 16px 10px;text-align:center}
#prompt .kicker{color:var(--gmut)}
#h-en{font-size:21px;font-weight:650;line-height:1.2;margin:2px 0 6px;text-wrap:balance}
#prompt.ok{animation:okp .6s}#prompt.no{animation:shake .35s}
.hrow{display:flex;gap:8px;justify-content:center;align-items:center;font-size:13px}
#h-time{font-variant-numeric:tabular-nums;min-width:3.2em;color:var(--gmut)}
.hrow button{background:rgba(255,255,255,.08);color:var(--gink);border:1px solid rgba(255,236,200,.22);border-radius:9px;padding:4px 10px;font-size:13px}
#map{position:absolute;right:max(12px,env(safe-area-inset-right));top:max(12px,env(safe-area-inset-top));width:150px;height:150px;border-radius:50%;border:1px solid rgba(255,236,200,.25);background:rgba(22,16,11,.7);box-shadow:0 6px 18px rgba(0,0,0,.4)}
#cross{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:rgba(255,244,220,.85);box-shadow:0 0 0 2px rgba(0,0,0,.35)}
#cross.on{width:14px;height:14px;margin:-7px 0 0 -7px;background:transparent;border:2px solid #f1d27a}
#look{position:absolute;left:50%;bottom:max(18px,env(safe-area-inset-bottom));transform:translateX(-50%);max-width:calc(100% - 32px);padding:10px 20px 11px;text-align:center}
#l-it{font-family:ui-serif,"Iowan Old Style","Palatino Linotype",Georgia,serif;font-size:26px;line-height:1.2}
#l-en{color:var(--gmut);font-size:15px;min-height:1.3em;transition:opacity .25s}
#l-en.veil{opacity:0}
#l-tip{font-size:12px;color:var(--gmut);opacity:.75}
#tips{position:absolute;left:max(12px,env(safe-area-inset-left));bottom:max(12px,env(safe-area-inset-bottom));padding:6px 10px;color:var(--gmut);max-width:46%}
#stick{position:absolute;width:110px;height:110px;margin:-55px 0 0 -55px;border-radius:50%;border:2px solid rgba(255,236,200,.35);background:rgba(22,16,11,.25);display:none}
#stick div{position:absolute;left:50%;top:50%;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:rgba(255,236,200,.35)}
#card{text-align:center;z-index:6}
#card h2{font-family:ui-serif,"Iowan Old Style","Palatino Linotype",Georgia,serif;font-size:34px;font-weight:500;margin:6px 0 2px}
#c-en{font-size:18px;margin:0 0 10px}
#c-ctx{font-family:ui-serif,"Iowan Old Style","Palatino Linotype",Georgia,serif;font-style:italic;font-size:16px;color:var(--ink2)}
#card .actions{justify-content:center}
.final{display:flex;flex-direction:column;align-items:center;margin:10px 0 2px}.final b{font-size:56px;line-height:1;font-variant-numeric:tabular-nums}.final span{color:var(--ink2);font-size:13px}
#over{text-align:center}#over .actions{justify-content:center}
.ostats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}
.ostats div{display:flex;flex-direction:column;padding:10px;border-radius:12px;background:var(--page)}
.ostats b{font-size:22px;font-variant-numeric:tabular-nums}.ostats span{font-size:12px;color:var(--ink2)}
.missed{text-align:left;margin-top:16px}
.missed ul{list-style:none;padding:0;margin:6px 0 12px;font-size:15px}
.missed li{display:flex;flex-wrap:wrap;gap:4px 10px;padding:7px 0;border-top:1px solid var(--grid)}
.missed .it{font-family:ui-serif,"Iowan Old Style","Palatino Linotype",Georgia,serif;font-size:17px;color:var(--good)}
.missed .en{color:var(--ink2)}
#toast{position:fixed;left:50%;top:30%;transform:translateX(-50%);max-width:calc(100% - 32px);background:var(--glass);color:var(--gink);padding:10px 16px;border-radius:12px;font-size:16px;text-align:center;z-index:4;pointer-events:none;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
#toast i{font-family:ui-serif,Georgia,serif;font-size:19px}
@keyframes okp{0%{box-shadow:0 0 0 0 rgba(47,210,138,.9)}100%{box-shadow:0 0 0 18px rgba(47,210,138,0)}}
@keyframes shake{20%,60%{transform:translateX(calc(-50% - 6px))}40%,80%{transform:translateX(calc(-50% + 6px))}}
@media (max-width:560px){#map{width:96px;height:96px}#prompt{max-width:calc(100% - 150px);min-width:0;padding:7px 10px 8px}#h-en{font-size:17px}.hbtn span{display:none}#l-it{font-size:22px}#tips{display:none}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
`;

// Client script. Kept as String.raw with no backticks or template holes, so
// regex escapes reach the browser unchanged.
const CLIENT_JS = String.raw`
(() => {
  const $ = (id) => document.getElementById(id);
  const D = JSON.parse($("data").textContent);
  const words = D.items;
  const motion = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  const cv = $("view");
  const gl = cv.getContext("webgl", { antialias: true, alpha: false });
  if (!gl) {
    $("nogl").hidden = false;
    for (const b of document.querySelectorAll("[data-mode]")) b.disabled = true;
    return;
  }
  const aniso = gl.getExtension("EXT_texture_filter_anisotropic") || gl.getExtension("WEBKIT_EXT_texture_filter_anisotropic");

  // ---------------------------------------------------------------- helpers
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function hash(n) {
    n = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); n ^= n >>> 13;
    n = Math.imul(n, 0xc2b2ae35); n ^= n >>> 16;
    return (n >>> 0) / 4294967296;
  }
  let seed = 911;
  function rand() {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const rgb = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
  const mulc = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
  function canvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  const SERIF = 'Georgia, "Times New Roman", serif';
  function fit(g, text, maxW, size, min, weight) {
    let s = size;
    for (;;) {
      g.font = weight + " " + s + "px " + SERIF;
      if (g.measureText(text).width <= maxW || s <= min) return s;
      s--;
    }
  }

  // ---------------------------------------------------------------- geometry
  // Batches: one per texture. Vertex = position, colour (lighting baked in), uv.
  const batches = [];
  function batch(src, repeat) {
    const b = { src, repeat: !!repeat, data: [], idx: [], nv: 0, tex: null, vbo: null, ibo: null, n: 0, dirty: false };
    batches.push(b);
    return b;
  }
  const LIGHT = (() => { const v = [0.36, 0.86, 0.42], l = Math.hypot(v[0], v[1], v[2]); return v.map((x) => x / l); })();
  const shade = (n) => 0.56 + 0.44 * (0.5 + 0.5 * (n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]));
  function quad(b, ps, c, uv, n, glow) {
    const start = b.idx.length, base = b.nv, s = glow ? 1 : shade(n);
    for (let i = 0; i < 4; i++) {
      const p = ps[i], ao = glow ? 1 : 0.66 + 0.34 * Math.min(1, p[1] / 1.6);
      b.data.push(p[0], p[1], p[2], c[0] * s * ao, c[1] * s * ao, c[2] * s * ao, uv ? uv[2 * i] : 0.5, uv ? uv[2 * i + 1] : 0.5);
    }
    b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    b.nv += 4;
    return { b, start, count: 6 };
  }
  function box(b, mn, mx, c, glow) {
    const [x0, y0, z0] = mn, [x1, y1, z1] = mx, start = b.idx.length;
    quad(b, [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], c, null, [1, 0, 0], glow);
    quad(b, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], c, null, [-1, 0, 0], glow);
    quad(b, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], c, null, [0, 0, 1], glow);
    quad(b, [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], c, null, [0, 0, -1], glow);
    quad(b, [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], c, null, [0, 1, 0], glow);
    quad(b, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], c, null, [0, -1, 0], glow);
    return { b, start, count: 36 };
  }
  // A horizontal tiled plane (floors), uv in units of size metres.
  function plane(b, x0, z0, x1, z1, y, size, n) {
    const uv = [x0 / size, z1 / size, x1 / size, z1 / size, x1 / size, z0 / size, x0 / size, z0 / size];
    return quad(b, [[x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]], [1, 1, 1], uv, n || [0, 1, 0]);
  }
  // A local frame on a wall: u runs along it (the viewer's right), d out of it.
  function frame(O, a, o) {
    const p = (u, y, d) => [O[0] + a[0] * u + o[0] * d, y, O[2] + a[2] * u + o[2] * d];
    const corners = (u0, u1, y0, y1, d0, d1) => {
      const P = p(u0, y0, d0), Q = p(u1, y1, d1);
      return [[Math.min(P[0], Q[0]), y0, Math.min(P[2], Q[2])], [Math.max(P[0], Q[0]), y1, Math.max(P[2], Q[2])]];
    };
    return {
      o, p, corners,
      box(b, u0, u1, y0, y1, d0, d1, c, glow) { const k = corners(u0, u1, y0, y1, d0, d1); return box(b, k[0], k[1], c, glow); },
      face(b, u0, u1, y0, y1, d, c, uv, glow) { return quad(b, [p(u0, y0, d), p(u1, y0, d), p(u1, y1, d), p(u0, y1, d)], c, uv, o, glow); },
    };
  }

  // Canvas atlases, 1024 square, cut into equal cells; each atlas is a batch.
  function family(cw, ch) { const cols = Math.floor(1024 / cw); return { cw, ch, cols, per: cols * Math.floor(1024 / ch), n: 0, list: [] }; }
  function cell(f) {
    const ai = Math.floor(f.n / f.per), k = f.n % f.per;
    f.n++;
    let at = f.list[ai];
    if (!at) {
      const c = canvas(1024, 1024);
      at = f.list[ai] = { c, g: c.getContext("2d"), b: batch(c) };
      at.g.fillStyle = "#2a2018"; at.g.fillRect(0, 0, 1024, 1024);
    }
    const x = (k % f.cols) * f.cw, y = Math.floor(k / f.cols) * f.ch;
    return {
      at, x, y, b: at.b,
      uv(w, h) { const u0 = (x + 0.5) / 1024, v0 = (y + 0.5) / 1024, u1 = (x + w - 0.5) / 1024, v1 = (y + h - 0.5) / 1024; return [u0, v1, u1, v1, u1, v0, u0, v0]; },
    };
  }
  const SPINES = family(64, 256), SIGNS = family(512, 128), PHOTOS = family(320, 240);

  // ---------------------------------------------------------------- textures drawn once
  function parquet() {
    const c = canvas(512, 512), g = c.getContext("2d");
    g.fillStyle = "#5a3b24"; g.fillRect(0, 0, 512, 512);
    for (let row = 0; row < 16; row++) {
      let x = -Math.floor(rand() * 200);
      while (x < 512) {
        const len = 140 + Math.floor(rand() * 180), k = 0.8 + rand() * 0.4;
        g.fillStyle = "rgb(" + Math.round(104 * k) + "," + Math.round(70 * k) + "," + Math.round(42 * k) + ")";
        g.fillRect(x + 1, row * 32 + 1, len - 2, 30);
        g.strokeStyle = "rgba(40,22,10,.18)"; g.lineWidth = 1;
        for (let i = 0; i < 4; i++) { const y = row * 32 + 4 + rand() * 24; g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + len / 3, y + rand() * 4 - 2, x + len * 0.6, y + rand() * 4 - 2, x + len, y); g.stroke(); }
        x += len;
      }
    }
    return c;
  }
  function marble() {
    const c = canvas(512, 512), g = c.getContext("2d");
    for (let i = 0; i < 4; i++) {
      const x = (i % 2) * 256, y = Math.floor(i / 2) * 256, light = (i % 2) === (Math.floor(i / 2) % 2);
      g.fillStyle = light ? "#e6dfcf" : "#34443a"; g.fillRect(x, y, 256, 256);
      g.strokeStyle = light ? "rgba(120,110,95,.22)" : "rgba(220,230,220,.14)";
      for (let v = 0; v < 6; v++) {
        g.lineWidth = 0.5 + rand() * 1.5; g.beginPath();
        let px = x + rand() * 256, py = y;
        g.moveTo(px, py);
        while (py < y + 256) { px += rand() * 40 - 20; py += 20 + rand() * 30; g.lineTo(clamp(px, x, x + 256), Math.min(py, y + 256)); }
        g.stroke();
      }
      g.strokeStyle = "rgba(0,0,0,.25)"; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, 254, 254);
    }
    return c;
  }
  function rug() {
    const c = canvas(256, 512), g = c.getContext("2d");
    g.fillStyle = "#6e1f1b"; g.fillRect(0, 0, 256, 512);
    g.fillStyle = "#1d2a4a"; g.fillRect(10, 10, 236, 492);
    g.fillStyle = "#6e1f1b"; g.fillRect(28, 28, 200, 456);
    g.strokeStyle = "#d9c39a"; g.lineWidth = 3; g.strokeRect(20, 20, 216, 472); g.strokeRect(34, 34, 188, 444);
    g.fillStyle = "#c9a96a";
    for (let y = 60; y < 470; y += 40) for (let x = 60; x < 210; x += 40) { g.beginPath(); g.moveTo(x, y - 8); g.lineTo(x + 8, y); g.lineTo(x, y + 8); g.lineTo(x - 8, y); g.fill(); }
    g.fillStyle = "#1d2a4a"; g.beginPath(); g.moveTo(128, 170); g.lineTo(200, 256); g.lineTo(128, 342); g.lineTo(56, 256); g.fill();
    g.strokeStyle = "#d9c39a"; g.stroke();
    return c;
  }
  const white = (() => { const c = canvas(2, 2), g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 2, 2); return c; })();

  const LEATHER = ["#dccfae", "#7a1f1f", "#1f4d33", "#1b2f55"];
  const GILT = ["#4a3320", "#e6c47a", "#e6c47a", "#f0d389"];
  function drawSpine(cl, w, h, word) {
    const g = cl.at.g, x = cl.x, y = cl.y, st = word.st;
    g.save();
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.fillStyle = LEATHER[st]; g.fillRect(x, y, w, h);
    const gr = g.createLinearGradient(x, 0, x + w, 0);
    gr.addColorStop(0, "rgba(0,0,0,.38)"); gr.addColorStop(0.32, "rgba(255,255,255,.12)"); gr.addColorStop(0.7, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0,.4)");
    g.fillStyle = gr; g.fillRect(x, y, w, h);
    g.fillStyle = GILT[st];
    for (const f of st === 3 ? [0.05, 0.075, 0.925, 0.95] : [0.06, 0.94]) g.fillRect(x + 3, y + Math.round(h * f), w - 6, 2);
    if (word.due) {
      const rx = x + w * 0.58, rw = Math.max(6, w * 0.24), rh = h * 0.17, sw = rw / 3;
      ["#009246", "#f1f2ec", "#ce2b37"].forEach((col, i) => { g.fillStyle = col; g.fillRect(rx + i * sw, y, sw + 0.5, rh); });
      g.fillStyle = LEATHER[st]; g.beginPath(); g.moveTo(rx, y + rh + 1); g.lineTo(rx + rw / 2, y + rh * 0.8); g.lineTo(rx + rw, y + rh + 1); g.fill();
    }
    // Titles on Italian spines read from the bottom up.
    g.translate(x + w / 2, y + h / 2);
    g.rotate(-Math.PI / 2);
    fit(g, word.it, h * 0.72, Math.floor(w * 0.5), 9, st === 0 ? "600" : "700");
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillStyle = st === 0 ? "#3b2a1a" : "rgba(0,0,0,.45)";
    if (st) g.fillText(word.it, 1, 2);
    g.fillStyle = GILT[st];
    g.fillText(word.it, 0, 1);
    g.restore();
  }
  function drawSign(cl, text, brass) {
    const g = cl.at.g, x = cl.x, y = cl.y, w = 512, h = 128;
    g.save();
    const gr = g.createLinearGradient(0, y, 0, y + h);
    if (brass) { gr.addColorStop(0, "#d9b864"); gr.addColorStop(1, "#8e6a22"); } else { gr.addColorStop(0, "#3a2416"); gr.addColorStop(1, "#24160d"); }
    g.fillStyle = gr; g.fillRect(x, y, w, h);
    g.strokeStyle = brass ? "#5a4110" : "#c9a457"; g.lineWidth = 4; g.strokeRect(x + 8, y + 8, w - 16, h - 16);
    fit(g, text, w * 0.84, 66, 16, "600");
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillStyle = brass ? "rgba(255,240,200,.55)" : "rgba(0,0,0,.6)"; g.fillText(text, x + w / 2 + 1, y + h / 2 + 3);
    g.fillStyle = brass ? "#2c1d06" : "#e6c47a"; g.fillText(text, x + w / 2, y + h / 2 + 2);
    g.restore();
  }

  // ---------------------------------------------------------------- the building
  const W0 = batch(white), FLOOR = batch(parquet(), true), MARBLE = batch(marble(), true), RUG = batch(rug());
  const walls = [];      // 3D boxes that block picking
  const solid = [];      // 2D footprints that block walking: [x0, z0, x1, z1]
  const picks = [];      // books and paintings: { kind, w, mn, mx, o, ranges }
  const cases = [];      // for the map: { mn, mx, label }
  const paintings = [];  // for the map
  const byWord = new Map();
  function wall(mn, mx, c) { box(W0, mn, mx, c); walls.push({ mn, mx }); solid.push([mn[0], mn[2], mx[0], mx[2]]); }
  function pickable(p) { picks.push(p); if (!byWord.has(p.w.id)) byWord.set(p.w.id, []); byWord.get(p.w.id).push(p); }

  // Shelving: words in alphabetical order, case by case, shelf by shelf.
  const CASE_W = 2.4, CASE_D = 0.42, CASE_H = 2.62, PITCH = 2.7, SHELF = [0.12, 0.64, 1.16, 1.68], U0 = 0.07, U1 = 2.33;
  // Words are spread evenly over the cases and their shelves, at most 48 to a
  // case (12 to a shelf, which leaves room for other books around them).
  const PER_SIDE = Math.max(2, Math.ceil(words.length / 96));
  const FILLER = ["#5b4636", "#3f3a33", "#6b5a43", "#4b2e2a", "#2f3b38", "#56493c", "#3a2e40"].map(rgb);
  const shelves = [];
  for (let ci = 0, total = PER_SIDE * 2 * 4; ci < PER_SIDE * 2; ci++) {
    const cs = [];
    for (let si = 0; si < 4; si++) {
      const k = ci * 4 + si, own = words.slice(Math.floor(k * words.length / total), Math.floor((k + 1) * words.length / total));
      const books = own.map((w) => {
        const h = hash(w.id);
        return { w, bw: 0.088 + Math.min(0.035, w.it.length * 0.0016) + h * 0.022, bh: 0.3 + hash(w.id + 7919) * 0.1, bd: 0.23 + h * 0.06 };
      });
      const width = books.reduce((a, b) => a + b.bw + 0.004, 0);
      const sh = [];
      let u = U0;
      const filler = (until) => {
        for (;;) {
          const bw = 0.028 + rand() * 0.05;
          if (u + bw > until) return;
          sh.push({ w: null, u, bw, bh: 0.24 + rand() * 0.15, bd: 0.2 + rand() * 0.08, c: mulc(FILLER[Math.floor(rand() * FILLER.length)], 0.75 + rand() * 0.35) });
          u += bw + 0.003 + (rand() < 0.08 ? rand() * 0.05 : 0);
        }
      };
      filler(U0 + Math.max(0, U1 - U0 - width) * rand() * 0.4);
      for (const b of books) { b.u = u; sh.push(b); u += b.bw + 0.004; }
      filler(U1);
      cs.push(sh);
    }
    shelves.push(cs);
  }

  const gallery = words.filter((w) => w.g);
  const LX = 3.5, LH = 4.2, LLEN = 1.2 + PER_SIDE * PITCH + 1.2;
  const GX = 2.5, GH = 3.8, GP = 2.1, G_SIDE = Math.ceil(gallery.length / 2), GZ0 = -LLEN - 0.2, GLEN = gallery.length ? G_SIDE * GP + 1.6 : 0;

  const WOOD = rgb("#4a2f1d"), WOOD_D = rgb("#2b1b10"), WOOD_L = rgb("#62412a"), BRASS = rgb("#b8913f"), STONE = rgb("#d6ccb8");

  // Library room.
  plane(FLOOR, -LX, -LLEN, LX, 0, 0, 2.2);
  box(W0, [-LX - 0.2, LH, -LLEN - 0.2], [LX + 0.2, LH + 0.2, 0.2], rgb("#3a2618"));
  for (let z = -1.2; z > -LLEN; z -= PITCH) box(W0, [-LX, LH - 0.28, z - 0.14], [LX, LH, z + 0.14], rgb("#2c1c11"));
  const RED = rgb("#5e2621");
  wall([-LX - 0.2, 0, -LLEN - 0.2], [-LX, LH, 0.2], RED);
  wall([LX, 0, -LLEN - 0.2], [LX + 0.2, LH, 0.2], RED);
  wall([-LX - 0.2, 0, 0], [LX + 0.2, LH, 0.2], RED);
  if (gallery.length) {
    wall([-LX - 0.2, 0, -LLEN - 0.2], [-0.9, LH, -LLEN], RED);
    wall([0.9, 0, -LLEN - 0.2], [LX + 0.2, LH, -LLEN], RED);
    box(W0, [-0.9, 2.5, -LLEN - 0.2], [0.9, LH, -LLEN], RED);
    walls.push({ mn: [-0.9, 2.5, -LLEN - 0.2], mx: [0.9, LH, -LLEN] });
    box(W0, [-1.05, 0, -LLEN - 0.25], [-0.9, 2.62, -LLEN + 0.05], STONE);
    box(W0, [0.9, 0, -LLEN - 0.25], [1.05, 2.62, -LLEN + 0.05], STONE);
    box(W0, [-1.05, 2.5, -LLEN - 0.25], [1.05, 2.66, -LLEN + 0.05], STONE);
  } else {
    wall([-LX - 0.2, 0, -LLEN - 0.2], [LX + 0.2, LH, -LLEN], RED);
  }
  // Wainscot on the end walls.
  for (const [z0, z1] of [[-0.03, 0], [-LLEN, -LLEN + 0.03]]) {
    for (const [x0, x1] of gallery.length && z0 < -1 ? [[-LX, -1.05], [1.05, LX]] : [[-LX, LX]]) box(W0, [x0, 0, z0], [x1, 1.05, z1], WOOD);
  }
  // Signs over the door and on the entrance wall.
  const sign = (fr, u0, u1, y0, y1, d, text, brass) => { const cl = cell(SIGNS); drawSign(cl, text, brass); fr.face(cl.b, u0, u1, y0, y1, d, [1.08, 1.08, 1.08], cl.uv(512, 128), true); };
  sign(frame([0, 0, -LLEN], [1, 0, 0], [0, 0, 1]), -0.8, 0.8, 2.82, 3.22, 0.004, gallery.length ? "La Galleria" : "La Biblioteca", false);
  sign(frame([0, 0, 0], [-1, 0, 0], [0, 0, -1]), -0.8, 0.8, 2.82, 3.22, 0.004, "La Biblioteca", false);

  // Reading table, lamps and rug down the middle.
  const TL = Math.min(3.2, LLEN - 5), TZ = -LLEN / 2;
  if (TL > 1) {
    const rz0 = TZ - TL / 2 - 0.9, rz1 = TZ + TL / 2 + 0.9;
    quad(RUG, [[-1.3, 0.004, rz1], [1.3, 0.004, rz1], [1.3, 0.004, rz0], [-1.3, 0.004, rz0]], [1, 1, 1], [0, 1, 1, 1, 1, 0, 0, 0], [0, 1, 0]);
    box(W0, [-0.5, 0.74, TZ - TL / 2], [0.5, 0.79, TZ + TL / 2], WOOD_L);
    for (const sx of [-0.42, 0.36]) for (const sz of [TZ - TL / 2 + 0.06, TZ + TL / 2 - 0.12]) box(W0, [sx, 0, sz], [sx + 0.06, 0.74, sz + 0.06], WOOD_D);
    for (const lz of [TZ - TL / 4, TZ + TL / 4]) {
      box(W0, [-0.08, 0.79, lz - 0.08], [0.08, 0.82, lz + 0.08], BRASS);
      box(W0, [-0.012, 0.82, lz - 0.012], [0.012, 1.06, lz + 0.012], BRASS);
      box(W0, [-0.1, 1.04, lz - 0.2], [0.1, 1.15, lz + 0.2], rgb("#1f7a4c"), true);
      box(W0, [-0.09, 1.035, lz - 0.19], [0.09, 1.04, lz + 0.19], [1.6, 1.4, 0.9], true);
    }
    solid.push([-0.55, TZ - TL / 2 - 0.05, 0.55, TZ + TL / 2 + 0.05]);
  }

  // Bookcases: left wall front to back, then the right wall back to front.
  shelves.forEach((cs, ci) => {
    const left = ci < PER_SIDE, k = left ? ci : ci - PER_SIDE;
    const fr = left
      ? frame([-LX, 0, -1.2 - k * PITCH], [0, 0, -1], [1, 0, 0])
      : frame([LX, 0, -1.2 - (PER_SIDE - 1 - k) * PITCH - CASE_W], [0, 0, 1], [-1, 0, 0]);
    fr.box(W0, 0, CASE_W, 0, CASE_H, 0, 0.03, WOOD_D);
    fr.box(W0, 0, 0.05, 0, CASE_H, 0, CASE_D, WOOD);
    fr.box(W0, CASE_W - 0.05, CASE_W, 0, CASE_H, 0, CASE_D, WOOD);
    fr.box(W0, -0.02, CASE_W + 0.02, 0, 0.12, 0, CASE_D + 0.02, WOOD_D);
    for (let s = 1; s < 4; s++) fr.box(W0, 0.05, CASE_W - 0.05, SHELF[s] - 0.03, SHELF[s], 0.03, CASE_D, WOOD_L);
    fr.box(W0, 0.05, CASE_W - 0.05, 2.17, 2.2, 0.03, CASE_D, WOOD_L);
    fr.box(W0, -0.04, CASE_W + 0.04, 2.2, CASE_H, 0, CASE_D + 0.05, WOOD);
    fr.box(W0, -0.06, CASE_W + 0.06, CASE_H, CASE_H + 0.05, 0, CASE_D + 0.08, WOOD_D);
    const fp = fr.corners(0, CASE_W, 0, CASE_H, 0, CASE_D + 0.02);
    solid.push([fp[0][0], fp[0][2], fp[1][0], fp[1][2]]);
    const ws = cs.flat().filter((b) => b.w);
    const label = ws.length ? (ws[0].w.k === ws[ws.length - 1].w.k ? ws[0].w.k : ws[0].w.k + " – " + ws[ws.length - 1].w.k) : "";
    if (label) sign(fr, 0.62, 1.78, 2.27, 2.56, CASE_D + 0.052, label, true);
    cases.push({ mn: fp[0], mx: fp[1], label, mid: fr.p(CASE_W / 2, 0, CASE_D + 0.5) });
    cs.forEach((sh, s) => {
      for (const bk of sh) {
        const y0 = SHELF[s], y1 = y0 + bk.bh, d0 = 0.4 - bk.bd;
        if (!bk.w) { fr.box(W0, bk.u, bk.u + bk.bw, y0, y1, d0, 0.4, bk.c); continue; }
        const w = bk.w, body = fr.box(W0, bk.u, bk.u + bk.bw, y0, y1, d0, 0.4, mulc(rgb(LEATHER[w.st]), 0.86 + hash(w.id + 31) * 0.2));
        // Fit the spine's real proportions into a 64 × 256 cell.
        const tall = bk.bh / bk.bw > 4, pw = tall ? Math.round(256 * bk.bw / bk.bh) : 64, ph = tall ? 256 : Math.round(64 * bk.bh / bk.bw);
        const cl = cell(SPINES);
        drawSpine(cl, pw, ph, w);
        const spine = fr.face(cl.b, bk.u, bk.u + bk.bw, y0, y1, 0.4015, [1, 1, 1], cl.uv(pw, ph));
        const k2 = fr.corners(bk.u, bk.u + bk.bw, y0, y1, d0, 0.402);
        pickable({ kind: "book", w, mn: k2[0], mx: k2[1], o: fr.o, ranges: [body, spine], at: fr.p(bk.u + bk.bw / 2, y1, 0.42), ci });
      }
    });
  });

  // Gallery: Pompeian red walls, a skylight, photos in gilt frames.
  if (gallery.length) {
    const Z1 = GZ0 - GLEN, POMP = rgb("#7d2a22");
    plane(MARBLE, -GX, Z1, GX, GZ0, 0, 1.5);
    box(W0, [-GX - 0.2, GH, Z1 - 0.2], [GX + 0.2, GH + 0.2, GZ0], rgb("#e3dccb"));
    quad(W0, [[-0.7, GH - 0.01, Z1 + 0.4], [0.7, GH - 0.01, Z1 + 0.4], [0.7, GH - 0.01, GZ0 - 0.4], [-0.7, GH - 0.01, GZ0 - 0.4]], [1.02, 0.98, 0.9], null, [0, -1, 0], true);
    wall([-GX - 0.2, 0, Z1 - 0.2], [-GX, GH, GZ0], POMP);
    wall([GX, 0, Z1 - 0.2], [GX + 0.2, GH, GZ0], POMP);
    wall([-GX - 0.2, 0, Z1 - 0.2], [GX + 0.2, GH, Z1], POMP);
    for (const s of [-1, 1]) {
      const x0 = s < 0 ? -GX : GX - 0.02, x1 = s < 0 ? -GX + 0.02 : GX;
      box(W0, [x0, 0, Z1], [x1, 0.16, GZ0], WOOD_D);
      box(W0, [s < 0 ? -GX : GX - 0.03, 2.72, Z1], [s < 0 ? -GX + 0.03 : GX, 2.76, GZ0], BRASS);
    }
    box(W0, [-GX, 0, Z1], [GX, 0.16, Z1 + 0.02], WOOD_D);
    sign(frame([0, 0, Z1], [1, 0, 0], [0, 0, 1]), -0.9, 0.9, 2.2, 2.65, 0.004, "Le parole in figura", false);
    for (let z = GZ0 - 3.2; z > Z1 + 2; z -= 7) {
      box(W0, [-0.28, 0.4, z - 0.9], [0.28, 0.46, z + 0.9], WOOD_L);
      for (const dz of [-0.8, 0.72]) box(W0, [-0.24, 0, z + dz], [0.24, 0.4, z + dz + 0.08], WOOD_D);
      solid.push([-0.3, z - 0.92, 0.3, z + 0.92]);
    }
    gallery.forEach((w, i) => {
      const left = i < G_SIDE, k = left ? i : i - G_SIDE;
      const fr = left
        ? frame([-GX, 0, GZ0 - 0.8 - k * GP], [0, 0, -1], [1, 0, 0])
        : frame([GX, 0, GZ0 - 0.8 - (G_SIDE - 1 - k) * GP - GP], [0, 0, 1], [-1, 0, 0]);
      const c = GP / 2, Y = 1.68;
      const fbox = fr.box(W0, c - 0.6, c + 0.6, Y - 0.47, Y + 0.47, 0, 0.06, rgb("#a8843a"));
      const inner = fr.box(W0, c - 0.53, c + 0.53, Y - 0.4, Y + 0.4, 0.06, 0.066, rgb("#2a1d10"));
      const cl = cell(PHOTOS);
      const photo = fr.face(cl.b, c - 0.5, c + 0.5, Y - 0.375, Y + 0.375, 0.0675, [1.12, 1.12, 1.12], cl.uv(320, 240), true);
      const pc = cell(SIGNS);
      drawSign(pc, w.it, true);
      fr.box(W0, c - 0.24, c + 0.24, 0.98, 1.1, 0, 0.012, BRASS);
      fr.face(pc.b, c - 0.24, c + 0.24, 0.98, 1.1, 0.0125, [1.05, 1.05, 1.05], pc.uv(512, 128), true);
      fr.box(W0, c - 0.28, c + 0.28, 2.3, 2.34, 0.05, 0.17, BRASS);
      const k2 = fr.corners(c - 0.6, c + 0.6, 0.98, Y + 0.47, 0, 0.07);
      pickable({ kind: "painting", w, mn: k2[0], mx: k2[1], o: fr.o, ranges: [fbox, inner, photo], at: fr.p(c, Y + 0.5, 0.3) });
      paintings.push(fr.p(c, 0, 0.1));
      if (w.pic) {
        const img = new Image();
        img.onload = () => {
          const s = Math.min(img.naturalWidth / 320, img.naturalHeight / 240), sw = 320 * s, sh = 240 * s;
          cl.at.g.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, cl.x, cl.y, 320, 240);
          cl.b.dirty = true;
        };
        img.src = D.pics + w.id + "?v=" + w.pic;
      }
    });
  }

  // ---------------------------------------------------------------- GL
  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER,
    "attribute vec3 aP;attribute vec3 aC;attribute vec2 aT;uniform mat4 uM;uniform vec3 uO;uniform vec3 uE;" +
    "varying vec3 vC;varying vec2 vT;varying float vD;" +
    "void main(){vec3 p=aP+uO;vC=aC;vT=aT;vD=distance(p,uE);gl_Position=uM*vec4(p,1.0);}"));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER,
    "precision mediump float;uniform sampler2D uS;uniform vec3 uF;uniform float uG;uniform vec3 uA;uniform float uAl;uniform float uFar;" +
    "varying vec3 vC;varying vec2 vT;varying float vD;" +
    "void main(){vec3 c=texture2D(uS,vT).rgb*vC*uG*(1.0+0.3*(1.0-smoothstep(0.0,3.5,vD)))+uA;" +
    "c=mix(c,uF,0.88*smoothstep(3.0,uFar,vD));gl_FragColor=vec4(c,uAl);}"));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const A = { P: gl.getAttribLocation(prog, "aP"), C: gl.getAttribLocation(prog, "aC"), T: gl.getAttribLocation(prog, "aT") };
  const U = {};
  for (const n of ["uM", "uO", "uE", "uS", "uF", "uG", "uA", "uAl", "uFar"]) U[n] = gl.getUniformLocation(prog, n);
  for (const k in A) gl.enableVertexAttribArray(A[k]);
  gl.uniform1i(U.uS, 0);
  const FOG = [0.07, 0.045, 0.03];
  gl.uniform3fv(U.uF, FOG);
  gl.uniform1f(U.uFar, 24);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.clearColor(FOG[0], FOG[1], FOG[2], 1);

  function texture(b) {
    if (!b.tex) b.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, b.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, b.src);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const wrap = b.repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  }
  for (const b of batches) {
    if (b.nv > 65535) throw new Error("batch too large");
    b.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(b.data), gl.STATIC_DRAW);
    b.ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(b.idx), gl.STATIC_DRAW);
    b.n = b.idx.length;
    b.data = b.idx = null;
    texture(b);
  }
  // The help beam: a column of light at the target, rebuilt when it moves.
  const beam = { b: { data: [], idx: [], nv: 0 }, vbo: gl.createBuffer(), ibo: gl.createBuffer(), n: 0, tex: batches[0].tex };
  function setBeam(points) {
    const b = beam.b;
    b.data = []; b.idx = []; b.nv = 0;
    for (const p of points) box(b, [p[0] - 0.16, 0, p[2] - 0.16], [p[0] + 0.16, 4.1, p[2] + 0.16], [1, 0.8, 0.35], true);
    gl.bindBuffer(gl.ARRAY_BUFFER, beam.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(b.data), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, beam.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(b.idx), gl.DYNAMIC_DRAW);
    beam.n = b.idx.length;
  }
  function bind(vbo, ibo, tex) {
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.vertexAttribPointer(A.P, 3, gl.FLOAT, false, 32, 0);
    gl.vertexAttribPointer(A.C, 3, gl.FLOAT, false, 32, 12);
    gl.vertexAttribPointer(A.T, 2, gl.FLOAT, false, 32, 24);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }
  const draw = (start, count) => { if (count > 0) gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, start * 2); };

  // ---------------------------------------------------------------- camera
  const me = { x: 0, z: -0.9, yaw: 0, pitch: -0.04, eye: 1.6 };
  let fovY = 1.2, aspect = 1, VP = new Float32Array(16);
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(innerWidth * dpr); cv.height = Math.round(innerHeight * dpr);
    gl.viewport(0, 0, cv.width, cv.height);
    aspect = innerWidth / Math.max(1, innerHeight);
    fovY = clamp(2 * Math.atan(Math.tan(0.7) / aspect), 0.95, 1.55);
  }
  addEventListener("resize", resize);
  resize();
  const basis = () => {
    const cp = Math.cos(me.pitch), sp = Math.sin(me.pitch), cy = Math.cos(me.yaw), sy = Math.sin(me.yaw);
    const f = [-sy * cp, sp, -cy * cp], r = [cy, 0, -sy];
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    return { f, r, u, e: [me.x, me.eye, me.z] };
  };
  function matrices() {
    const { f, r, u, e } = basis(), n = 0.05, fr = 60, t = 1 / Math.tan(fovY / 2);
    const P = [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (fr + n) / (n - fr), -1, 0, 0, (2 * fr * n) / (n - fr), 0];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const V = [r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -dot(r, e), -dot(u, e), dot(f, e), 1];
    for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += P[k * 4 + rr] * V[c * 4 + k];
      VP[c * 4 + rr] = s;
    }
  }

  // ---------------------------------------------------------------- picking
  function hitBox(o, d, mn, mx) {
    let t0 = 0, t1 = 1e9;
    for (let i = 0; i < 3; i++) {
      const inv = 1 / (d[i] || 1e-9);
      let a = (mn[i] - o[i]) * inv, b = (mx[i] - o[i]) * inv;
      if (a > b) { const x = a; a = b; b = x; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t1 < t0) return -1;
    }
    return t0;
  }
  // nx, ny: normalised device coordinates of the point looked at.
  function pickAt(nx, ny) {
    const { f, r, u, e } = basis(), ty = Math.tan(fovY / 2), tx = ty * aspect;
    const d = [f[0] + r[0] * nx * tx + u[0] * ny * ty, f[1] + r[1] * nx * tx + u[1] * ny * ty, f[2] + r[2] * nx * tx + u[2] * ny * ty];
    const l = Math.hypot(d[0], d[1], d[2]);
    d[0] /= l; d[1] /= l; d[2] /= l;
    let best = null, bt = 6.5;
    for (const p of picks) { const t = hitBox(e, d, p.mn, p.mx); if (t >= 0 && t < bt) { bt = t; best = p; } }
    if (best) for (const w of walls) { const t = hitBox(e, d, w.mn, w.mx); if (t >= 0 && t < bt) return null; }
    return best;
  }

  // ---------------------------------------------------------------- input
  const keys = new Set();
  let state = "menu", hover = null, hoverSince = 0, locked = false, noLock = false, mouse = null, touchUsed = matchMedia("(pointer: coarse)").matches;
  const joy = { id: null, x0: 0, y0: 0, dx: 0, dy: 0, t0: 0 }, lookT = { id: null, x: 0, y: 0, moved: 0, t0: 0, x0: 0, y0: 0 };
  const playing = () => state === "explore" || state === "hunt";
  const turn = (dx, dy, k) => { me.yaw -= dx * k; me.pitch = clamp(me.pitch - dy * k, -1.25, 1.25); };

  addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!$("card").hidden) { if (e.key === "Escape") closeCard(); return; }
    if (e.key === "Escape") { if (playing() && !locked) { e.preventDefault(); openMenu(); } else if (state === "menu" && lastMode) { e.preventDefault(); resume(); } return; }
    if (!playing()) return;
    if (/^(Arrow|Key[WASD]|Shift|Space)/.test(e.code)) e.preventDefault();
    keys.add(e.code);
    if (e.code === "KeyE" || e.code === "Enter" || e.code === "Space") { const p = locked || touchUsed ? pickAt(0, 0) : hover; if (p) choose(p); }
    if (state === "hunt" && e.code === "KeyH") hint();
    if (state === "hunt" && e.code === "KeyN") skip();
    if (e.code === "KeyM") $("map").hidden = !$("map").hidden;
  });
  addEventListener("keyup", (e) => keys.delete(e.code));
  addEventListener("blur", () => keys.clear());

  document.addEventListener("pointerlockchange", () => { locked = document.pointerLockElement === cv; $("cross").hidden = !(locked || touchUsed); });
  document.addEventListener("pointerlockerror", () => { noLock = true; });
  cv.addEventListener("mousedown", (e) => { if (e.button === 0) mouse = { x: e.clientX, y: e.clientY, moved: 0, drag: true }; });
  addEventListener("mousemove", (e) => {
    if (!playing() || !$("card").hidden) return;
    if (locked) { turn(e.movementX, e.movementY, 0.0024); return; }
    if (mouse && mouse.drag && e.buttons & 1) { mouse.moved += Math.abs(e.movementX) + Math.abs(e.movementY); turn(e.movementX, e.movementY, 0.005); }
    mouse = Object.assign(mouse || {}, { x: e.clientX, y: e.clientY });
  });
  addEventListener("mouseup", (e) => {
    if (!mouse || !mouse.drag || e.button !== 0) return;
    mouse.drag = false;
    if (!playing() || e.target !== cv || mouse.moved > 6) return;
    if (locked) { const p = pickAt(0, 0); if (p) choose(p); return; }
    const p = pickAt((e.clientX / innerWidth) * 2 - 1, 1 - (e.clientY / innerHeight) * 2);
    if (p) choose(p);
    else if (!noLock && cv.requestPointerLock) { try { const r = cv.requestPointerLock(); if (r && r.catch) r.catch(() => { noLock = true; }); } catch (err) { noLock = true; } }
  });

  const stick = $("stick");
  cv.addEventListener("touchstart", (e) => {
    e.preventDefault();
    if (!touchUsed) { touchUsed = true; $("cross").hidden = false; }
    if (!playing()) return;
    for (const t of e.changedTouches) {
      if (t.clientX < innerWidth * 0.42 && joy.id === null) {
        Object.assign(joy, { id: t.identifier, x0: t.clientX, y0: t.clientY, dx: 0, dy: 0, t0: performance.now() });
        stick.style.display = "block"; stick.style.left = t.clientX + "px"; stick.style.top = t.clientY + "px";
        stick.firstElementChild.style.transform = "";
      } else if (lookT.id === null) {
        Object.assign(lookT, { id: t.identifier, x: t.clientX, y: t.clientY, x0: t.clientX, y0: t.clientY, moved: 0, t0: performance.now() });
      }
    }
  }, { passive: false });
  cv.addEventListener("touchmove", (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === joy.id) {
        const dx = t.clientX - joy.x0, dy = t.clientY - joy.y0, l = Math.hypot(dx, dy), k = l > 50 ? 50 / l : 1;
        joy.dx = dx * k / 50; joy.dy = dy * k / 50;
        stick.firstElementChild.style.transform = "translate(" + dx * k + "px," + dy * k + "px)";
      } else if (t.identifier === lookT.id) {
        const dx = t.clientX - lookT.x, dy = t.clientY - lookT.y;
        lookT.moved += Math.abs(dx) + Math.abs(dy);
        lookT.x = t.clientX; lookT.y = t.clientY;
        if (playing() && $("card").hidden) turn(dx, dy, 0.0065);
      }
    }
  }, { passive: false });
  const touchEnd = (e) => {
    for (const t of e.changedTouches) {
      const tap = (o) => o.moved < 12 && performance.now() - o.t0 < 400;
      if (t.identifier === joy.id) {
        const moved = Math.hypot(t.clientX - joy.x0, t.clientY - joy.y0);
        if (moved < 12 && performance.now() - joy.t0 < 400) tapAt(t.clientX, t.clientY);
        joy.id = null; joy.dx = joy.dy = 0; stick.style.display = "none";
      } else if (t.identifier === lookT.id) {
        if (tap(lookT)) tapAt(t.clientX, t.clientY);
        lookT.id = null;
      }
    }
  };
  function tapAt(x, y) {
    if (!playing() || !$("card").hidden) return;
    const p = pickAt((x / innerWidth) * 2 - 1, 1 - (y / innerHeight) * 2) || pickAt(0, 0);
    if (p) choose(p);
  }
  cv.addEventListener("touchend", touchEnd);
  cv.addEventListener("touchcancel", touchEnd);

  // ---------------------------------------------------------------- movement
  function blocked(x, z) {
    const R = 0.28;
    for (const s of solid) if (x > s[0] - R && x < s[2] + R && z > s[1] - R && z < s[3] + R) return true;
    return false;
  }
  function move(dt) {
    let fw = 0, st = 0;
    if (keys.has("KeyW") || keys.has("ArrowUp")) fw += 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) fw -= 1;
    if (keys.has("KeyD")) st += 1;
    if (keys.has("KeyA")) st -= 1;
    if (keys.has("ArrowLeft")) me.yaw += dt * 1.9;
    if (keys.has("ArrowRight")) me.yaw -= dt * 1.9;
    if (joy.id !== null) { fw -= joy.dy; st += joy.dx; }
    const l = Math.hypot(fw, st);
    if (l < 0.05) return;
    if (l > 1) { fw /= l; st /= l; }
    const sp = (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 4.6 : 2.5) * dt;
    const cy = Math.cos(me.yaw), sy = Math.sin(me.yaw);
    const dx = (-sy * fw + cy * st) * sp, dz = (-cy * fw - sy * st) * sp;
    if (!blocked(me.x + dx, me.z)) me.x += dx;
    if (!blocked(me.x, me.z + dz)) me.z += dz;
  }

  // ---------------------------------------------------------------- map
  const MS = 9, MX0 = -LX - 0.4, MZ0 = -LLEN - 0.2 - GLEN - 0.6;
  const mapBg = canvas(Math.ceil((2 * LX + 0.8) * MS), Math.ceil((LLEN + GLEN + 1.4) * MS));
  {
    const g = mapBg.getContext("2d"), X = (x) => (x - MX0) * MS, Z = (z) => (z - MZ0) * MS;
    g.fillStyle = "rgba(120,80,50,.55)"; g.fillRect(X(-LX), Z(-LLEN), 2 * LX * MS, LLEN * MS);
    if (gallery.length) { g.fillStyle = "rgba(170,60,50,.5)"; g.fillRect(X(-GX), Z(GZ0 - GLEN), 2 * GX * MS, GLEN * MS); g.fillRect(X(-0.9), Z(GZ0), 1.8 * MS, 0.2 * MS); }
    g.font = "600 10px system-ui,sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    for (const c of cases) {
      g.fillStyle = "#c9a96a"; g.fillRect(X(c.mn[0]), Z(c.mn[2]), (c.mx[0] - c.mn[0]) * MS, (c.mx[2] - c.mn[2]) * MS);
      if (c.label) { g.fillStyle = "#f4ecdc"; g.fillText(c.label.replace(" – ", "–"), X(c.mid[0] + (c.mid[0] < 0 ? 0.25 : -0.25)), Z(c.mid[2])); }
    }
    g.fillStyle = "#e6c47a";
    for (const p of paintings) g.fillRect(X(p[0]) - 3, Z(p[2]) - 3, 6, 6);
  }
  const map = $("map"), mg = map.getContext("2d");
  function drawMap(now) {
    if (map.hidden) return;
    const s = map.width, R = s / 2;
    mg.clearRect(0, 0, s, s);
    mg.save();
    mg.beginPath(); mg.arc(R, R, R, 0, 7); mg.clip();
    mg.drawImage(mapBg, R - (me.x - MX0) * MS, R - (me.z - MZ0) * MS);
    if (hunt && hunt.hinted) {
      for (const p of byWord.get(hunt.target.id) || []) {
        let x = (p.at[0] - me.x) * MS, z = (p.at[2] - me.z) * MS;
        const l = Math.hypot(x, z);
        if (l > R - 8) { x *= (R - 8) / l; z *= (R - 8) / l; }
        mg.fillStyle = "rgba(255,210,90," + (0.6 + 0.4 * Math.sin(now / 150)) + ")";
        mg.beginPath(); mg.arc(R + x, R + z, 5, 0, 7); mg.fill();
      }
    }
    mg.translate(R, R); mg.rotate(-me.yaw);
    mg.fillStyle = "#fff"; mg.beginPath(); mg.moveTo(0, -8); mg.lineTo(5.5, 6); mg.lineTo(0, 3); mg.lineTo(-5.5, 6); mg.closePath(); mg.fill();
    mg.restore();
  }

  // ---------------------------------------------------------------- render
  function render(now) {
    for (const b of batches) if (b.dirty) { b.dirty = false; texture(b); break; }
    matrices();
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(U.uM, false, VP);
    gl.uniform3f(U.uE, me.x, me.eye, me.z);
    gl.uniform3f(U.uO, 0, 0, 0);
    gl.uniform3f(U.uA, 0, 0, 0);
    gl.uniform1f(U.uG, 1);
    gl.uniform1f(U.uAl, 1);
    const pulled = hover && hover.kind === "book" ? hover.ranges : [];
    for (const b of batches) {
      bind(b.vbo, b.ibo, b.tex);
      const skip = pulled.filter((r) => r.b === b).sort((x, y) => x.start - y.start);
      let at = 0;
      for (const r of skip) { draw(at, r.start - at); at = r.start + r.count; }
      draw(at, b.n - at);
    }
    const again = (p, off, gain, add) => {
      gl.uniform3f(U.uO, p.o[0] * off, 0, p.o[2] * off);
      gl.uniform1f(U.uG, gain);
      gl.uniform3fv(U.uA, add);
      for (const r of p.ranges) { bind(r.b.vbo, r.b.ibo, r.b.tex); draw(r.start, r.count); }
    };
    const pulse = motion ? 0.5 + 0.5 * Math.sin(now / 180) : 0.6;
    if (hunt && hunt.hinted) for (const p of byWord.get(hunt.target.id) || []) if (p !== hover) again(p, 0, 1.1, [0.25 * pulse, 0.18 * pulse, 0.04 * pulse]);
    if (hover) again(hover, hover.kind === "book" ? 0.07 : 0, 1.3, [0.05, 0.04, 0.02]);
    if (hunt && hunt.hinted && beam.n) {
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false);
      gl.uniform3f(U.uO, 0, 0, 0); gl.uniform3f(U.uA, 0, 0, 0);
      gl.uniform1f(U.uG, 0.16 + 0.12 * pulse);
      bind(beam.vbo, beam.ibo, beam.tex);
      draw(0, beam.n);
      gl.depthMask(true); gl.disable(gl.BLEND);
    }
  }

  // ---------------------------------------------------------------- HUD
  const look = $("look");
  function updateHover(now) {
    let p = null;
    if (playing() && $("card").hidden) {
      if (locked || touchUsed || !mouse) p = pickAt(0, 0);
      else p = pickAt((mouse.x / innerWidth) * 2 - 1, 1 - (mouse.y / innerHeight) * 2);
    }
    if (p !== hover) {
      hover = p; hoverSince = now;
      look.hidden = !p;
      $("cross").classList.toggle("on", !!p);
      if (p) {
        $("l-it").textContent = p.w.it;
        $("l-en").textContent = state === "explore" ? p.w.en : "";
        $("l-en").classList.add("veil");
        $("l-tip").textContent = state === "explore" ? (touchUsed ? "tap to open" : "click to open") : "";
      }
    }
    // The meaning shows after a moment: time to recall it first.
    if (hover && state === "explore" && now - hoverSince > 1100) $("l-en").classList.remove("veil");
  }

  let toastTimer;
  function toast(html, ms) {
    const t = $("toast");
    t.replaceChildren(...html);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms || 2600);
  }
  const em = (s) => { const i = document.createElement("i"); i.textContent = s; return i; };
  const fmt = (ms) => { const s = Math.round(ms / 1000); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  async function post(url, body) {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
    return j;
  }

  // ---------------------------------------------------------------- explore: the card
  const STAGE = ["Not yet recalled", "Learning", "Young", "Mature"];
  let cardWord = null;
  function openCard(w) {
    cardWord = w;
    if (document.exitPointerLock && locked) document.exitPointerLock();
    $("c-stage").textContent = STAGE[w.st] + (w.due ? " · due today" : w.st ? " · every " + w.iv + (w.iv === 1 ? " day" : " days") : "");
    $("c-it").textContent = w.it;
    $("c-en").textContent = w.en;
    $("c-note").textContent = w.note || ""; $("c-note").hidden = !w.note;
    $("c-ctx").textContent = w.ctx ? "“" + w.ctx + "”" : ""; $("c-ctx").hidden = !w.ctx;
    const b = $("c-due");
    b.hidden = w.due; b.disabled = false; b.textContent = "Drill it today";
    $("card").hidden = false;
    $("c-close").focus({ preventScroll: true });
  }
  function closeCard() { $("card").hidden = true; cardWord = null; cv.focus({ preventScroll: true }); }
  $("c-close").addEventListener("click", closeCard);
  $("c-due").addEventListener("click", async () => {
    const b = $("c-due"), w = cardWord;
    if (!w) return;
    b.disabled = true;
    try { await post(D.due, { ids: [w.id] }); w.due = true; b.textContent = "In today's drill"; }
    catch (e) { b.disabled = false; toast([document.createTextNode("Couldn't add it (" + e.message + ").")]); }
  });

  // ---------------------------------------------------------------- hunt
  let hunt = null, lastMode = null;
  function chooseTargets(n) {
    const pool = words.slice(), out = [];
    while (out.length < n && pool.length) {
      let r = Math.random() * pool.reduce((a, w) => a + w.w, 0), i = 0;
      for (; i < pool.length - 1; i++) { r -= pool[i].w; if (r <= 0) break; }
      out.push(pool.splice(i, 1)[0]);
    }
    return out;
  }
  function showTarget() {
    const h = hunt;
    h.target = h.queue[h.i]; h.hinted = false;
    $("h-en").textContent = h.target.en;
    $("h-prog").textContent = " · " + (h.i + 1) + " / " + h.queue.length;
  }
  function flash(cls) { const p = $("prompt"); p.classList.remove("ok", "no"); void p.offsetWidth; p.classList.add(cls); }
  function next() {
    hunt.i++;
    if (hunt.i >= hunt.queue.length) return finish();
    showTarget();
  }
  function choose(p) {
    if (state === "explore") return openCard(p.w);
    if (state !== "hunt") return;
    const h = hunt;
    if (p.w.id === h.target.id) {
      if (!h.missed.has(p.w.id)) h.clean++;
      flash("ok");
      toast([document.createTextNode("Trovato! "), em(p.w.it)], 1400);
      next();
    } else {
      h.wrong++; h.penalty += 5000; h.missed.add(h.target.id);
      flash("no");
      toast([document.createTextNode("No: "), em(p.w.it), document.createTextNode(" is “" + p.w.en + "”. +5\u00a0s")]);
    }
  }
  function hint() {
    const h = hunt;
    if (!h || h.hinted) return;
    h.hinted = true; h.helps++; h.penalty += 10000; h.missed.add(h.target.id);
    setBeam((byWord.get(h.target.id) || []).map((p) => p.at));
    toast([document.createTextNode("Follow the light. +10\u00a0s")], 1800);
  }
  function skip() {
    const h = hunt;
    if (!h) return;
    if (!h.hinted) h.helps++;
    h.missed.add(h.target.id); h.penalty += 15000;
    toast([document.createTextNode("“" + h.target.en + "” was "), em(h.target.it), document.createTextNode(". +15\u00a0s")], 3200);
    next();
  }
  $("h-hint").addEventListener("click", hint);
  $("h-skip").addEventListener("click", skip);

  function readBest(n) { try { return Number(localStorage.getItem("palazzo.best." + n)) || 0; } catch (e) { return 0; } }
  function saveBest(n, ms) { try { localStorage.setItem("palazzo.best." + n, String(ms)); } catch (e) {} }
  function finish() {
    const h = hunt, total = performance.now() - h.t0 + h.penalty, n = h.queue.length;
    hunt = null; state = "over";
    if (document.exitPointerLock && locked) document.exitPointerLock();
    $("hud").hidden = true; look.hidden = true;
    $("o-time").textContent = fmt(total);
    $("o-clean").textContent = h.clean + " / " + n;
    $("o-wrong").textContent = h.wrong;
    $("o-hints").textContent = h.helps;
    const best = readBest(n);
    if (!best || total < best) saveBest(n, total);
    $("o-best").textContent = !best ? "First hunt of " + n + " words: a time to beat." : total < best ? "Nuovo record! Previous best " + fmt(best) + "." : "Best " + fmt(best) + ".";
    const list = $("o-list");
    list.replaceChildren();
    const missed = h.queue.filter((w) => h.missed.has(w.id));
    for (const w of missed) {
      const li = document.createElement("li"), a = document.createElement("span"), b = document.createElement("span");
      a.className = "it"; a.textContent = w.it; b.className = "en"; b.textContent = w.en;
      li.append(a, b); list.append(li);
    }
    $("o-missed").hidden = !missed.length;
    const due = $("o-due");
    due.disabled = false;
    due.textContent = missed.length === 1 ? "Drill this one today" : "Drill these " + missed.length + " today";
    due.onclick = async () => {
      due.disabled = true;
      try { const r = await post(D.due, { ids: missed.map((w) => w.id) }); due.textContent = r.count === 1 ? "1 word is in today's drill" : r.count + " words are in today's drill"; }
      catch (e) { due.disabled = false; toast([document.createTextNode("Couldn't add them (" + e.message + ").")]); }
    };
    $("over").hidden = false;
  }

  // ---------------------------------------------------------------- modes
  function enter(mode) {
    $("menu").hidden = true; $("over").hidden = true; $("card").hidden = true;
    $("hud").hidden = false; $("resume").hidden = true;
    state = mode; lastMode = mode; hover = null; look.hidden = true;
    $("cross").hidden = !(locked || touchUsed);
    $("prompt").hidden = mode !== "hunt";
    $("tips").textContent = touchUsed ? "" : (noLock ? "Drag to look · click a book" : "Click to look around · WASD to walk · Esc for the mouse");
    cv.focus({ preventScroll: true });
  }
  function start(mode) {
    Object.assign(me, { x: 0, z: -0.9, yaw: 0, pitch: -0.04 });
    if (mode === "hunt") {
      const q = chooseTargets(Math.min(10, words.length));
      hunt = { queue: q, i: 0, t0: performance.now(), penalty: 0, missed: new Set(), clean: 0, wrong: 0, helps: 0, target: null, hinted: false };
      showTarget();
    } else hunt = null;
    enter(mode);
  }
  let pausedAt = 0;
  function openMenu() {
    if (document.exitPointerLock && locked) document.exitPointerLock();
    pausedAt = performance.now();
    state = "menu";
    $("hud").hidden = true; look.hidden = true;
    $("resume").hidden = !lastMode;
    $("menu").hidden = false;
  }
  function resume() {
    if (hunt) hunt.t0 += performance.now() - pausedAt;
    enter(lastMode);
  }
  for (const b of document.querySelectorAll("[data-mode]")) b.addEventListener("click", () => start(b.dataset.mode));
  $("resume").addEventListener("click", resume);
  $("menu-btn").addEventListener("click", openMenu);

  // ---------------------------------------------------------------- loop
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (playing() && $("card").hidden) move(dt);
    else if (state === "menu" && !lastMode && motion) me.yaw = Math.sin(now / 5200) * 0.5;
    updateHover(now);
    if (hunt) $("h-time").textContent = fmt(now - hunt.t0 + hunt.penalty);
    render(now);
    if (playing()) drawMap(now);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
`;


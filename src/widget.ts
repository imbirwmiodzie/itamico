// Desktop widget: a small page that cycles through the hardest words, meant to
// sit in a fixed spot on screen (desktop/macos/itamico.lua pins it there).
// The page fetches /widget/<token>/data itself, so the host only loads a URL.

import type { Db } from "./db.js";
import { today } from "./db.js";
import { PAGE_CSS } from "./page.js";
import { streak } from "./stats.js";

export interface WidgetWord {
  id: number;
  italian: string;
  english: string;
  note: string | null;
  context: string | null;
  due: boolean;
  attempts: number;
  fails: number;
  /** What was said the last time it was failed. */
  last_wrong: string | null;
}

export interface WidgetData {
  today: string;
  due: number;
  streak: number;
  words: WidgetWord[];
}

/**
 * The words worth seeing: most failed first, then lowest ease, then due
 * soonest. Mature words (interval of 3+ weeks) are left out unless due, so
 * the rotation stays on what hasn't stuck yet.
 */
export async function loadWidget(db: Db, timeZone: string, limit = 12): Promise<WidgetData> {
  const day = today(timeZone);
  const [words, due, active] = await Promise.all([
    db.query(
      `select i.id::int as id, i.italian, i.english, i.note, i.context,
              (i.due_on <= $1) as due,
              count(a.id)::int as attempts,
              count(a.id) filter (where a.grade < 3)::int as fails,
              (array_agg(a.answer order by a.at desc) filter (where a.grade < 3))[1] as last_wrong
         from items i left join attempts a on a.item_id = i.id
        where i.interval_days < 21 or i.due_on <= $1
        group by i.id
        order by fails desc, i.ease, i.due_on, i.id
        limit $2`,
      [day, limit],
    ),
    db.query(`select count(*)::int as n from items where due_on <= $1`, [day]),
    db.query(
      `select distinct to_char((at at time zone $1)::date, 'YYYY-MM-DD') as day from attempts
        where at > now() - interval '400 days' order by 1 desc`,
      [timeZone],
    ),
  ]);
  return {
    today: day,
    due: due.rows[0].n,
    streak: streak(active.rows.map((r) => r.day), day),
    words: words.rows,
  };
}

export interface WidgetOptions {
  /** Seconds each word stays up. */
  every: number;
  /** Seconds before the English is shown: time to recall it yourself. */
  reveal: number;
  /** How many words to cycle through. */
  n: number;
  /** Which side is shown first: "english" makes it a recall drill, like the rides. */
  side: "italian" | "english";
  theme?: "light" | "dark";
}

/** Read the page options from the query string, clamped to sane ranges. */
export function widgetOptions(q: Record<string, unknown>): WidgetOptions {
  const int = (v: unknown, def: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) && v !== "" && v !== undefined ? Math.min(max, Math.max(min, Math.round(n))) : def;
  };
  const every = int(q.every, 60, 10, 3600);
  const theme = q.theme === "light" || q.theme === "dark" ? q.theme : undefined;
  const side = q.side === "english" ? "english" : "italian";
  return { every, reveal: int(q.reveal, Math.round(every / 3), 0, every), n: int(q.n, 12, 1, 50), side, theme };
}

/** JSON inside a <script> element: escape "<" so text like "</script>" can't end it. */
const scriptJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

export function renderWidget(data: WidgetData, token: string, o: WidgetOptions): string {
  const dataUrl = `/widget/${encodeURIComponent(token)}/data?n=${o.n}`;
  return `<!doctype html>
<html lang="en"${o.theme ? ` data-theme="${o.theme}"` : ""}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex">
<title>Italian words</title>
<style>
${PAGE_CSS}
/* The host window is transparent; the card is the widget. */
html,body{height:100%;background:transparent}
body{overflow:hidden;-webkit-user-select:none;user-select:none;cursor:default}
.w{position:relative;height:100%;display:flex;flex-direction:column;gap:2px;padding:12px 16px 14px;overflow:hidden;
  background:var(--surface);border:1px solid var(--ring);border-radius:14px}
.top{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--ink2);font-variant-numeric:tabular-nums}
.top .pos{margin-left:auto;color:var(--muted)}
.dot{width:7px;height:7px;border-radius:50%;background:var(--bad);display:none}
.offline .dot{display:inline-block}
.it{font-size:clamp(20px,8.5vw,32px);font-weight:650;line-height:1.15;margin-top:6px;overflow-wrap:anywhere}
.it.long{font-size:clamp(17px,6vw,24px)}
.after{display:flex;flex-direction:column;gap:3px;opacity:0;transition:opacity .6s}
.shown .after,.w:hover .after{opacity:1}
.hint{font-size:12px;color:var(--muted);margin-top:2px}
.shown .hint,.w:hover .hint{display:none}
.en{font-size:16px;color:var(--ink)}
.ctx{font-size:13px;color:var(--ink2);font-style:italic;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.said{font-size:12px;color:var(--ink2)}
.said s{color:var(--bad);text-decoration-thickness:1px}
.empty{margin:auto 0;color:var(--ink2);font-size:14px}
.bar{position:absolute;left:0;bottom:0;height:3px;background:var(--s1);opacity:.55;width:0}
</style>
</head>
<body>
<div class="w" id="w" title="Click to show the answer, again for the next word">
  <div class="top"><span class="dot" title="Offline: showing the last words loaded"></span><span id="due"></span><span id="streak"></span><span class="pos" id="pos"></span></div>
  <div id="card"></div>
  <div class="bar" id="bar"></div>
</div>
<script id="data" type="application/json">${scriptJson(data)}</script>
<script>
(() => {
  const EVERY = ${o.every * 1000}, REVEAL = ${o.reveal * 1000}, REFRESH = 10 * 60 * 1000;
  const DATA_URL = ${scriptJson(dataUrl)}, SIDE = ${scriptJson(o.side)};
  let data = JSON.parse(document.getElementById("data").textContent);
  let offset = 0, shownIndex = -1, revealTimer = 0;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  // The word follows the clock, so a reload keeps the rotation where it was.
  const slot = () => Math.floor(Date.now() / EVERY);

  function header() {
    $("due").textContent = data.due ? data.due + " due today" : "Nothing due";
    $("streak").textContent = data.streak ? data.streak + "-day streak" : "";
  }

  function show(force) {
    const words = data.words;
    if (!words.length) {
      $("pos").textContent = "";
      $("card").innerHTML = '<p class="empty">No words yet. Ask the tutor about a word on your next ride.</p>';
      $("bar").style.width = "0";
      return;
    }
    const i = (((slot() + offset) % words.length) + words.length) % words.length;
    if (i === shownIndex && !force) return;
    shownIndex = i;
    const w = words[i];
    $("pos").textContent = (i + 1) + " / " + words.length;
    const said = w.last_wrong && w.last_wrong.trim().toLowerCase() !== w.italian.toLowerCase()
      ? '<div class="said">you said <s>' + esc(w.last_wrong) + "</s>" + (w.fails > 1 ? " · missed " + w.fails + "×" : "") + "</div>"
      : w.fails ? '<div class="said">missed ' + w.fails + "×</div>" : "";
    const [front, back] = SIDE === "english" ? [w.english, w.italian] : [w.italian, w.english];
    $("card").innerHTML =
      '<div class="it' + (front.length > 22 ? " long" : "") + '">' + esc(front) + "</div>" +
      '<div class="hint" id="hint"></div>' +
      '<div class="after"><div class="en">' + esc(back) + (w.note ? ' <span class="said">· ' + esc(w.note) + "</span>" : "") + "</div>" +
      (w.context ? '<div class="ctx">“' + esc(w.context) + "”</div>" : "") + said + "</div>";
    $("w").classList.remove("shown");
    clearTimeout(revealTimer);
    const left = EVERY - (Date.now() % EVERY);
    // Picked by hand or already past the recall time: show the answer straight away.
    if (force || EVERY - left >= REVEAL) $("w").classList.add("shown");
    else revealTimer = setTimeout(() => $("w").classList.add("shown"), REVEAL - (EVERY - left));
  }

  function tick() {
    const bar = $("bar");
    bar.style.width = data.words.length ? ((Date.now() % EVERY) / EVERY) * 100 + "%" : "0";
    show(false);
    const hint = $("hint");
    if (hint) hint.textContent = (SIDE === "english" ? "Italian" : "English") + " in " + Math.max(1, Math.ceil((REVEAL - (Date.now() % EVERY)) / 1000)) + " s";
  }

  async function refresh() {
    try {
      const r = await fetch(DATA_URL, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      data = await r.json();
      $("w").classList.remove("offline");
      header();
      show(true);
    } catch {
      $("w").classList.add("offline"); // keep the words we have
    }
  }

  // First click shows the answer, the next one moves on.
  $("w").addEventListener("click", () => {
    if (!$("w").classList.contains("shown")) $("w").classList.add("shown");
    else { offset++; show(true); }
  });
  header();
  tick();
  setInterval(tick, 1000);
  setInterval(refresh, REFRESH);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
})();
</script>
</body>
</html>`;
}

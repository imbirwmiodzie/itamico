// Il Caso: a mystery the tutor tells in episodes, one per ride. Its clues are
// the user's weakest words, and the plot follows how well they are remembered:
// a clue that lapses in SM-2 brings a setback, one that holds for three weeks
// is a breakthrough, and the finale only unlocks when every clue is secured.
//
// The server keeps what makes the story continuous across rides: the premise,
// the solution (fixed at the start, so the mystery stays consistent), the story
// so far and an episode log. The tutor writes them; this file stores them and
// renders the case board at /case/<token>.

import type { Db } from "./db.js";
import { esc, nav, PAGE_CSS } from "./page.js";
import { shortDate } from "./stats.js";
import { TutorError } from "./store.js";

/** A clue is secured once its review interval reaches this many days. */
export const SECURED_DAYS = 21;
export const MIN_CLUES = 3, MAX_CLUES = 6;
const CANDIDATES = 5;

// How far a clue is from secured, 0..4: 0 = not recalled yet (or lapsed),
// then the SM-2 steps 1 day, 6 days, ~2 weeks, and 3 weeks or more.
const STAGE_SQL = `case when i.repetitions = 0 then 0 when i.interval_days < 6 then 1
  when i.interval_days < 14 then 2 when i.interval_days < ${SECURED_DAYS} then 3 else 4 end`;
export const STAGES = 4;

interface Clue {
  item_id: number;
  italian: string;
  english: string;
  stage: number;
  stage_seen: number;
  due_today: boolean;
  pic: number | null;
}

export interface CaseFile {
  id: number;
  title: string;
  premise: string;
  solution: string;
  story: string;
  episodes: number;
  outcome: "solved" | "dropped" | null;
  opened: string;
  closed: string | null;
  clues: Clue[];
}

const CASE_COLS = `id::int as id, title, premise, solution, story, episodes, outcome,
  to_char(opened_at at time zone $TZ, 'YYYY-MM-DD') as opened, to_char(closed_at at time zone $TZ, 'YYYY-MM-DD') as closed`;

async function clues(db: Db, caseId: number, day: string): Promise<Clue[]> {
  const { rows } = await db.query(
    `select i.id::int as item_id, i.italian, i.english, ${STAGE_SQL} as stage, cc.stage_seen,
            (i.due_on <= $2) as due_today, floor(extract(epoch from p.fetched_at))::float8 as pic
       from case_clues cc join items i on i.id = cc.item_id left join pictures p on p.item_id = i.id
      where cc.case_id = $1
      order by cc.ord`,
    [caseId, day],
  );
  return rows;
}

/** The open case, if any. */
export async function openCaseFile(db: Db, day: string, timeZone: string): Promise<CaseFile | null> {
  const { rows } = await db.query(`select ${CASE_COLS.replaceAll("$TZ", "$1")} from cases where outcome is null`, [timeZone]);
  return rows[0] ? { ...rows[0], clues: await clues(db, rows[0].id, day) } : null;
}

const secured = (c: Clue) => c.stage >= STAGES;

/** What changed for each clue since the last saved episode, for the tutor to narrate. */
export function caseEvents(cl: Clue[]): string[] {
  const out: string[] = [];
  for (const c of cl) {
    if (c.stage < c.stage_seen) out.push(`"${c.italian}" went cold (was ${c.stage_seen}/${STAGES}, now ${c.stage}/${STAGES}): make it a setback in the plot.`);
    else if (c.stage >= STAGES && c.stage_seen < STAGES) out.push(`"${c.italian}" is now secured: a breakthrough.`);
    else if (c.stage > c.stage_seen) out.push(`"${c.italian}" got stronger (${c.stage_seen}/${STAGES} → ${c.stage}/${STAGES}): a small lead.`);
  }
  return out;
}

const EPISODE = `Tell this episode: one line of recap, then 6-10 short beats in Italian, each ending in something the user must say: a gap for one of today's due items (give its English, never the Italian; grade it with record_attempt like a drill, and make a due clue a big moment) or a decision the user makes as the detective, in a full Italian sentence. Clues not due today may only be mentioned in passing, never as a gap. Narrate every event. Stay consistent with the premise, the story so far and the secret solution. End on a cliffhanger, then call save_episode.`;
const FINALE = `Every clue is secured: this is the finale. Ask the user to name the culprit and explain why in Italian, using the clue words. Then reveal the solution, congratulate them, and call save_episode with outcome "solved".`;

/** get_case: the open case as the tutor needs it, or the clues to open one with. */
export async function caseForTutor(db: Db, day: string, timeZone: string) {
  const f = await openCaseFile(db, day, timeZone);
  if (!f) {
    const { rows } = await db.query(
      `select i.id::int as item_id, i.italian, i.english, i.note
         from items i
        where array_length(regexp_split_to_array(btrim(i.italian), '\\s+'), 1) <= 4
          and not (i.repetitions > 0 and i.interval_days >= ${SECURED_DAYS})
        order by (select count(*) from attempts a where a.item_id = i.id and a.grade < 3) desc, i.ease, i.repetitions, random()
        limit ${CANDIDATES}`,
    );
    return {
      case: null,
      candidate_clues: rows.map((r) => (r.note ? r : { item_id: r.item_id, italian: r.italian, english: r.english })),
      instruction:
        rows.length >= MIN_CLUES
          ? `No case is open. Invent a short noir mystery set in Italy in which ${MIN_CLUES}-${MAX_CLUES} of these words can each be a clue: an Italian title, a premise of 2-3 sentences, and a secret solution (who did it, how, and how each clue proves it). Call open_case with them and the clue item_ids, then tell episode 1.`
          : `No case is open, and a case needs ${MIN_CLUES} words that aren't learned yet; there are ${rows.length}. Tell the user, and carry on with the drill and conversation.`,
    };
  }
  const solvable = f.clues.length > 0 && f.clues.every(secured);
  return {
    case: {
      case_id: f.id,
      title: f.title,
      episode: f.episodes + 1,
      premise: f.premise,
      solution: f.solution,
      story_so_far: f.story || "Nothing yet: this is episode 1.",
      clues: f.clues.map((c) => ({
        item_id: c.item_id,
        italian: c.italian,
        english: c.english,
        progress: `${c.stage}/${STAGES}`,
        secured: secured(c),
        due_today: c.due_today,
      })),
      events: caseEvents(f.clues),
      solvable,
    },
    instruction: (solvable ? FINALE : EPISODE) + " The solution is secret until the finale.",
  };
}

/** start_session: a one-line view of the open case, so the tutor can offer it. */
export async function caseSummary(db: Db, day: string, timeZone: string) {
  const f = await openCaseFile(db, day, timeZone);
  if (!f) return null;
  return {
    title: f.title,
    next_episode: f.episodes + 1,
    clues_secured: `${f.clues.filter(secured).length}/${f.clues.length}`,
    due_clues: f.clues.filter((c) => c.due_today).length,
    solvable: f.clues.length > 0 && f.clues.every(secured),
  };
}

const text = (v: string, name: string, max: number) => {
  const s = v.trim();
  if (!s) throw new TutorError(`${name} must not be empty`);
  if (s.length > max) throw new TutorError(`${name} is longer than ${max} characters`);
  return s;
};

export async function openCase(
  db: Db,
  day: string,
  timeZone: string,
  input: { title: string; premise: string; solution: string; clue_ids: number[] },
) {
  const ids = [...new Set(input.clue_ids)];
  if (ids.length < MIN_CLUES || ids.length > MAX_CLUES) throw new TutorError(`a case needs ${MIN_CLUES}-${MAX_CLUES} different clue item_ids`);
  const found = await db.query(`select id::int as id from items where id = any($1::bigint[])`, [ids]);
  const missing = ids.filter((id) => !found.rows.some((r) => r.id === id));
  if (missing.length) throw new TutorError(`no item with id ${missing.join(", ")}`);

  const c = await db.connect();
  try {
    await c.query("begin");
    const ins = await c.query(`insert into cases (title, premise, solution) values ($1, $2, $3) returning id::int as id`, [
      text(input.title, "title", 120),
      text(input.premise, "premise", 1000),
      text(input.solution, "solution", 1500),
    ]);
    const id = ins.rows[0].id as number;
    await c.query(
      `insert into case_clues (case_id, item_id, ord, stage_seen)
       select $1, i.id, array_position($2::bigint[], i.id), ${STAGE_SQL} from items i where i.id = any($2::bigint[])`,
      [id, ids],
    );
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    if ((e as { code?: string }).code === "23505") throw new TutorError("a case is already open: continue it, or close it with save_episode first");
    throw e;
  } finally {
    c.release();
  }
  return caseForTutor(db, day, timeZone);
}

/**
 * Save an episode: its one-line headline, the rewritten story so far and,
 * for the last one, how the case ended. Each clue's current stage is noted,
 * so the next episode hears what went cold or got secured since.
 */
export async function saveEpisode(
  db: Db,
  day: string,
  timeZone: string,
  input: { case_id: number; headline: string; story_so_far: string; outcome?: "solved" | "dropped" },
) {
  const headline = text(input.headline, "headline", 200);
  const story = text(input.story_so_far, "story_so_far", 3000);
  const f = await openCaseFile(db, day, timeZone);
  if (!f || f.id !== input.case_id) throw new TutorError(`case ${input.case_id} is not the open case`);
  const notSecured = f.clues.filter((c) => !secured(c));
  if (input.outcome === "solved" && notSecured.length)
    throw new TutorError(`case can't be solved yet: ${notSecured.map((c) => c.italian).join(", ")} not secured; end this episode on a cliffhanger instead`);

  const n = f.episodes + 1;
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query(`insert into case_episodes (case_id, n, headline) values ($1, $2, $3)`, [f.id, n, headline]);
    await c.query(
      `update cases set story = $2, episodes = $3, outcome = $4, closed_at = case when $4::text is null then null else now() end where id = $1`,
      [f.id, story, n, input.outcome ?? null],
    );
    await c.query(
      `update case_clues cc set stage_seen = ${STAGE_SQL} from items i where cc.case_id = $1 and i.id = cc.item_id`,
      [f.id],
    );
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
  return {
    case_id: f.id,
    episode: n,
    closed: input.outcome ?? null,
    clues: f.clues.map((cl) => ({ italian: cl.italian, progress: `${cl.stage}/${STAGES}` })),
  };
}

// ------------------------------------------------------------------ the board

export interface CaseBoard {
  open: (CaseFile & { log: { n: number; headline: string; day: string }[] }) | null;
  closed: (CaseFile & { log: { n: number; headline: string; day: string }[] })[];
}

export async function loadCaseBoard(db: Db, day: string, timeZone: string): Promise<CaseBoard> {
  const { rows } = await db.query(
    `select ${CASE_COLS.replaceAll("$TZ", "$1")} from cases order by (outcome is null) desc, closed_at desc nulls first, id desc limit 20`,
    [timeZone],
  );
  const files = await Promise.all(
    rows.map(async (r) => {
      const log = await db.query(
        `select n, headline, to_char(at at time zone $2, 'YYYY-MM-DD') as day from case_episodes where case_id = $1 order by n`,
        [r.id, timeZone],
      );
      return { ...r, clues: await clues(db, r.id, day), log: log.rows };
    }),
  );
  return { open: files.find((f) => f.outcome === null) ?? null, closed: files.filter((f) => f.outcome !== null) };
}

/** The Progress page's card for the open case. */
export function caseCard(f: CaseFile | null, token: string): string {
  if (!f) return "";
  const n = f.clues.filter(secured).length;
  return `<section class="card casecard"><h2>Il Caso: <span lang="it">${esc(f.title)}</span></h2>
<p class="sub">${f.episodes} ${f.episodes === 1 ? "episode" : "episodes"} so far · ${n} of ${f.clues.length} clues secured. The finale unlocks when every clue has held for ${SECURED_DAYS} days.</p>
<ul class="caseclues">${f.clues.map((c) => `<li><span lang="it">${esc(c.italian)}</span>${pips(c.stage)}</li>`).join("")}</ul>
<a href="/case/${encodeURIComponent(token)}">Open the case board</a></section>`;
}

export const CASE_CARD_CSS = `.caseclues{list-style:none;padding:0;margin:0 0 10px;display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:6px 18px;font-size:14px}
.caseclues li{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--grid)}
.casecard .pips{display:inline-flex;gap:3px}.casecard .pips i{width:14px;height:6px;border-radius:2px;background:var(--grid)}.casecard .pips i.on{background:var(--s1)}
.casecard a{font-size:14px;color:var(--s1)}`;

const pips = (stage: number) =>
  `<span class="pips" role="img" aria-label="${stage} of ${STAGES}">${Array.from({ length: STAGES }, (_, i) => `<i${i < stage ? ' class="on"' : ""}></i>`).join("")}</span>`;

/** Small, deterministic tilt per card, so the board looks pinned by hand. */
const tilt = (id: number) => (((id * 37) % 7) - 3) * 0.8;

function clueCard(c: Clue, token: string): string {
  const t = encodeURIComponent(token);
  const stamp = secured(c) ? `<span class="stamp ok">Assicurato</span>` : c.stage === 0 && c.stage_seen > 0 ? `<span class="stamp cold">Freddo</span>` : "";
  const face = c.pic
    ? `<img src="/pic/${t}/${c.item_id}?v=${c.pic}" alt="" loading="lazy">`
    : `<div class="word" lang="it">${esc(c.italian)}</div>`;
  return `<figure class="clue${secured(c) ? " secured" : ""}" style="--tilt:${tilt(c.item_id)}deg" data-pin>
  <span class="pin" aria-hidden="true"></span>
  <div class="face">${face}${stamp}</div>
  <figcaption>${c.pic ? `<b lang="it">${esc(c.italian)}</b>` : ""}<span>${esc(c.english)}</span>
  <span class="meta">${pips(c.stage)}${c.due_today ? `<span class="due">oggi</span>` : ""}</span></figcaption>
</figure>`;
}

export function renderCase(b: CaseBoard, token: string): string {
  const f = b.open;
  const securedCount = f ? f.clues.filter(secured).length : 0;
  const solvable = !!f && f.clues.length > 0 && securedCount === f.clues.length;
  const log = (x: NonNullable<CaseBoard["open"]>) =>
    x.log.length
      ? `<ol class="log">${x.log.map((e) => `<li><span class="n">Ep. ${e.n}</span><span class="d">${esc(shortDate(e.day))}</span><span>${esc(e.headline)}</span></li>`).join("")}</ol>`
      : `<p class="muted">No episodes yet.</p>`;

  const board = f
    ? `<header class="file-head">
  <div><div class="kicker">Caso n. ${f.id} · aperto ${esc(shortDate(f.opened))} · ${f.episodes} ${f.episodes === 1 ? "episodio" : "episodi"}</div>
  <h1 lang="it">${esc(f.title)}</h1></div>
  <div class="score"><b>${securedCount}/${f.clues.length}</b><span>clues secured</span></div>
</header>
<section class="cork" id="cork">
  <svg class="strings" id="strings" aria-hidden="true"></svg>
  <figure class="suspect${solvable ? " ready" : ""}" data-center>
    <span class="pin" aria-hidden="true"></span>
    <div class="face"><div class="q">?</div></div>
    <figcaption><b>${solvable ? "Pronto per il finale" : "Il colpevole"}</b><span>${solvable ? "Every clue holds. Ride, and name the culprit." : `Revealed when all ${f.clues.length} clues hold for 3 weeks`}</span></figcaption>
  </figure>
  ${f.clues.map((c) => clueCard(c, token)).join("")}
</section>
<p class="legend">${pips(2)} how close a clue is to secured: it needs to stay remembered for ${SECURED_DAYS} days. <span class="due">oggi</span> due on today's ride. A clue that slips goes <b>freddo</b> and the story takes a setback.</p>
<div class="dossier">
  <section class="paper"><h2>Il caso</h2><p lang="it">${esc(f.premise)}</p>
  <h2>Finora</h2><p lang="it" class="story">${esc(f.story || "La storia comincia al prossimo giro.")}</p></section>
  <section class="paper"><h2>Episodi</h2>${log(f)}
  <div class="sealed"><span>Soluzione</span><b>Sigillata</b></div></section>
</div>`
    : `<section class="empty paper">
  <div class="kicker">Nessun caso aperto</div>
  <h1>Il Caso</h1>
  <p>A mystery told in episodes on your rides, with your weakest words as the clues. Say <b>“il caso”</b> to the tutor and it opens one.</p>
  <ul>
    <li>Each episode is a few minutes of story. It stops at gaps only your due words can fill, and asks you what the detective does next.</li>
    <li>A clue counts as secured when you've remembered it for ${SECURED_DAYS} days. If you forget one, the case goes cold for a while.</li>
    <li>The finale unlocks when every clue is secured. Then you name the culprit.</li>
  </ul>
</section>`;

  const archive = b.closed.length
    ? `<section class="archive"><h2>Archivio</h2>${b.closed
        .map(
          (c) => `<details class="paper closed"><summary><span class="stamp ${c.outcome === "solved" ? "ok" : "cold"}">${c.outcome === "solved" ? "Risolto" : "Archiviato"}</span>
<b lang="it">${esc(c.title)}</b><span class="muted">${c.episodes} ${c.episodes === 1 ? "episodio" : "episodi"} · ${esc(shortDate(c.closed ?? c.opened))}</span></summary>
<p class="clues-line" lang="it">${c.clues.map((x) => esc(x.italian)).join(" · ")}</p>
<h3>Soluzione</h3><p lang="it">${esc(c.solution)}</p>${log(c)}</details>`,
        )
        .join("")}</section>`
    : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Il Caso</title>
<style>
${PAGE_CSS}
${CASE_CSS}
</style></head><body><main class="case">
${nav(token, "case")}
${board}
${archive}
</main>
<script>${CLIENT_JS}</script>
</body></html>`;
}

const CASE_CSS = `:root{--cork:#c9a273;--cork2:#b98f5f;--cork-dot:rgba(90,55,20,.18);--paper:#fbf8f0;--paper-ink:#2a2620;--string:#c0262d;--pin:#d23a3a;--ok:#1e7a46;--cold:#2c6db3;--shadow:rgba(40,25,5,.35)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--cork:#5b4630;--cork2:#4d3b28;--cork-dot:rgba(0,0,0,.25);--paper:#ece6d6;--string:#e0444b;--shadow:rgba(0,0,0,.6)}}
:root[data-theme="dark"]{--cork:#5b4630;--cork2:#4d3b28;--cork-dot:rgba(0,0,0,.25);--paper:#ece6d6;--string:#e0444b;--shadow:rgba(0,0,0,.6)}
main.case{max-width:960px}
.kicker{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:600}
.file-head{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;margin-bottom:12px}
.file-head h1{font-family:ui-serif,"Iowan Old Style","Palatino Linotype",Georgia,serif;font-size:clamp(26px,5vw,36px);margin:2px 0 0}
.score{text-align:right;display:flex;flex-direction:column}.score b{font-size:28px;line-height:1}.score span{font-size:12px;color:var(--ink2)}
.cork{position:relative;border-radius:14px;padding:30px 22px 26px;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:30px 22px;
background:radial-gradient(var(--cork-dot) 1px,transparent 1.6px) 0 0/9px 9px,radial-gradient(var(--cork-dot) 1px,transparent 1.4px) 4px 5px/13px 11px,linear-gradient(135deg,var(--cork),var(--cork2));
box-shadow:inset 0 0 0 10px rgba(80,50,20,.35),inset 0 0 40px rgba(0,0,0,.25)}
.strings{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:1}
.strings path{fill:none;stroke:var(--string);stroke-width:1.6;stroke-linecap:round;opacity:.85}
.strings path.weak{stroke-dasharray:5 5;opacity:.55}
.clue,.suspect{position:relative;z-index:2;margin:0;background:var(--paper);color:var(--paper-ink);padding:9px 9px 10px;border-radius:2px;transform:rotate(var(--tilt,0deg));
box-shadow:0 1px 1px rgba(0,0,0,.15),0 10px 18px -8px var(--shadow);transition:transform .2s}
.clue:hover{transform:rotate(0) scale(1.03);z-index:3}
.pin{position:absolute;top:-7px;left:50%;width:14px;height:14px;margin-left:-7px;border-radius:50%;z-index:4;
background:radial-gradient(circle at 35% 35%,#ff9a9a,var(--pin) 45%,#7d1717);box-shadow:0 2px 3px rgba(0,0,0,.45)}
.face{position:relative;aspect-ratio:1;background:#e9e3d3;display:grid;place-items:center;overflow:hidden}
.face img{width:100%;height:100%;object-fit:cover;filter:sepia(.25) contrast(1.05)}
.word{font-family:"Marker Felt","Segoe Print","Bradley Hand","Comic Sans MS",cursive;font-size:22px;text-align:center;padding:8px;line-height:1.15;color:#3a2f22}
figcaption{display:flex;flex-direction:column;gap:2px;margin-top:8px;font-size:13px}
figcaption b{font-family:ui-serif,"Iowan Old Style","Palatino Linotype",Georgia,serif;font-size:17px;font-weight:600}
figcaption span{color:#6b6255}
.meta{display:flex;align-items:center;justify-content:space-between;margin-top:4px}
.pips{display:inline-flex;gap:3px}.pips i{width:16px;height:6px;border-radius:2px;background:rgba(0,0,0,.14)}.pips i.on{background:var(--ok)}
.due{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#fff;background:var(--string);border-radius:3px;padding:1px 5px}
.stamp{position:absolute;right:6px;bottom:10px;transform:rotate(-12deg);font:800 13px/1 ui-monospace,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;
padding:4px 7px;border:2.5px solid currentColor;border-radius:4px;background:rgba(251,248,240,.75);mix-blend-mode:multiply}
.stamp.ok{color:var(--ok)}.stamp.cold{color:var(--cold)}
.suspect{grid-column:1/-1;justify-self:center;width:min(220px,70%);--tilt:-1.5deg;background:#f3ead2}
.suspect .face{aspect-ratio:4/3;background:repeating-linear-gradient(0deg,#ddd3bb 0 18px,#d4c9ae 18px 19px)}
.suspect .q{font:700 64px/1 ui-serif,Georgia,serif;color:rgba(60,40,20,.55)}
.suspect.ready .q{color:var(--string)}
.legend{font-size:12px;color:var(--ink2);margin:10px 2px 0;display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.legend .pips i:not(.on){background:var(--grid)}
.dossier{display:grid;grid-template-columns:1.4fr 1fr;gap:14px;margin-top:18px}
.paper{background:var(--paper);color:var(--paper-ink);border-radius:4px;padding:18px 20px;box-shadow:0 1px 1px rgba(0,0,0,.08),0 12px 26px -16px var(--shadow);
background-image:linear-gradient(rgba(0,0,0,.035) 1px,transparent 1px);background-size:100% 26px}
.paper h2{font:700 12px/1 ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;margin:0 0 8px;color:#7a6e5c}
.paper h2:not(:first-child){margin-top:18px}
.paper p{font-family:ui-serif,"Iowan Old Style","Palatino Linotype",Georgia,serif;font-size:16px;line-height:1.6;margin:0}
.paper .muted{color:#7a6e5c}
.log{list-style:none;padding:0;margin:0;font-size:14px}
.log li{display:grid;grid-template-columns:auto auto 1fr;gap:4px 10px;padding:6px 0;border-bottom:1px dashed rgba(0,0,0,.15)}
.log .n{font:700 12px/1.6 ui-monospace,Menlo,monospace;color:var(--string)}.log .d{color:#7a6e5c;font-size:12px;line-height:1.7}
.sealed{margin-top:18px;border:1.5px dashed rgba(0,0,0,.3);border-radius:4px;padding:14px;text-align:center;display:flex;flex-direction:column;gap:2px;
background:repeating-linear-gradient(45deg,transparent 0 10px,rgba(0,0,0,.03) 10px 20px)}
.sealed span{font:700 11px/1 ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#7a6e5c}
.sealed b{font:800 20px/1.2 ui-monospace,Menlo,monospace;letter-spacing:.2em;text-transform:uppercase;color:var(--string)}
.empty{max-width:620px;margin:10px auto}.empty h1{font-family:ui-serif,Georgia,serif;font-size:34px;margin:4px 0 8px}
.empty ul{font-size:15px;line-height:1.55;padding-left:20px}.empty p{margin-bottom:10px}
.archive{margin-top:26px}.archive>h2{font-size:16px;margin:0 0 8px}
.closed{margin-top:10px;padding:14px 18px}.closed summary{cursor:pointer;display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;list-style:none}
.closed summary b{font-family:ui-serif,Georgia,serif;font-size:18px}
.closed .stamp{position:static;transform:rotate(-4deg);font-size:11px}
.closed h3{font:700 12px/1 ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#7a6e5c;margin:14px 0 6px}
.clues-line{margin-top:10px!important;font-size:14px!important;color:#6b6255}
@media (max-width:640px){.cork{grid-template-columns:repeat(2,1fr);gap:24px 14px;padding:26px 12px 20px}.dossier{grid-template-columns:1fr}.word{font-size:18px}
.file-head{flex-direction:column;align-items:flex-start}.score{text-align:left}}
@media (prefers-reduced-motion:reduce){.clue{transition:none}}
`;

// Red string from every clue's pin to the suspect's, redrawn on resize. Solid
// for secured clues, dashed for the rest. Plain JS: no template holes.
const CLIENT_JS = String.raw`
(() => {
  const cork = document.getElementById("cork"), svg = document.getElementById("strings");
  if (!cork || !svg) return;
  const center = cork.querySelector("[data-center] .pin");
  function draw() {
    const box = cork.getBoundingClientRect();
    const at = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2 - box.left, r.top + r.height / 2 - box.top]; };
    const [cx, cy] = at(center);
    svg.setAttribute("viewBox", "0 0 " + box.width + " " + box.height);
    svg.replaceChildren();
    for (const card of cork.querySelectorAll("[data-pin]")) {
      const [x, y] = at(card.querySelector(".pin"));
      const sag = Math.min(60, Math.hypot(x - cx, y - cy) * 0.18);
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", "M" + cx + "," + cy + " Q" + (cx + x) / 2 + "," + ((cy + y) / 2 + sag) + " " + x + "," + y);
      if (!card.classList.contains("secured")) p.setAttribute("class", "weak");
      svg.append(p);
    }
  }
  draw();
  addEventListener("resize", draw);
  addEventListener("load", draw);
})();
`;

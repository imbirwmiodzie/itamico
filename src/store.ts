// All tutor state and logic: sessions and the timer, gap capture, due items,
// attempts and SM-2 scheduling. The MCP layer in tools.ts is a thin wrapper.

import type pg from "pg";
import type { Db } from "./db.js";
import { today } from "./db.js";
import { capGrade, countFillers, sm2 } from "./grading.js";
import { loadStats } from "./stats.js";

export type Mode = "word" | "sentence";
/** Voice modes, plus "screen" for answers graded on the drill page. */
export type AttemptMode = Mode | "screen";
export type Source = "asked" | "fallback" | "error" | "topic_check";
export type ListFilter = "due" | "recent" | "all";
export type ItemFilter = "all" | "due" | "nocontext" | "failed";
export const SOURCES: Source[] = ["asked", "fallback", "error", "topic_check"];

// Full-text search: one 'simple' (language-agnostic) document per item, over
// all four text fields, lower-cased and with Italian accents folded so "perche"
// finds "perché". The same expression backs the GIN index in schema.sql.
const FOLD_FROM = "àáâäèéêëìíîïòóôöùúûü";
const FOLD_TO = "aaaaeeeeiiiioooouuuu";
const ITEM_TEXT_SQL = `translate(lower(italian || ' ' || english || ' ' || coalesce(note, '') || ' ' || coalesce(context, '')), '${FOLD_FROM}', '${FOLD_TO}')`;
const ITEM_DOC_SQL = `to_tsvector('simple', ${ITEM_TEXT_SQL})`;

export function foldText(s: string): string {
  let out = s.toLowerCase();
  for (let i = 0; i < FOLD_FROM.length; i++) out = out.replaceAll(FOLD_FROM[i], FOLD_TO[i]);
  return out;
}

/** Search words as prefix terms for to_tsquery: letters and digits only, so input can't inject query syntax. */
export function searchTerms(q: string): string[] {
  return foldText(q).split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, 8);
}

/** Word mode only drills items short enough to say in one breath while riding. */
export const WORD_MODE_MAX_WORDS = 4;

/** An open session older than this is treated as abandoned (the app was just closed). */
const STALE_SESSION = "12 hours";

const WORD_COUNT_SQL = `array_length(regexp_split_to_array(btrim(italian), '\\s+'), 1)`;

export interface Clock {
  session_id: number;
  /** Whole minutes left, rounded up; absent for a session without a limit. */
  minutes_left?: number;
  time_up?: true;
}

export class TutorError extends Error {}

export class Store {
  constructor(
    private readonly db: Db,
    private readonly timeZone: string,
  ) {}

  private today(): string {
    return today(this.timeZone);
  }

  // ---------------------------------------------------------------- sessions

  /** The open session the timer refers to, if any. */
  async clock(): Promise<Clock | null> {
    const { rows } = await this.db.query(
      `select id::int as id,
              case when limit_min is null then null
                   else greatest(0, ceil((limit_min * 60 - extract(epoch from now() - started_at)) / 60.0))::int
              end as minutes_left
         from sessions
        where ended_at is null and started_at > now() - interval '${STALE_SESSION}'
        order by started_at desc
        limit 1`,
    );
    if (!rows[0]) return null;
    const clock: Clock = { session_id: rows[0].id };
    if (rows[0].minutes_left !== null) {
      clock.minutes_left = rows[0].minutes_left;
      if (rows[0].minutes_left === 0) clock.time_up = true;
    }
    return clock;
  }

  async startSession(limitMin?: number | null) {
    const day = this.today();
    return this.tx(async (c) => {
      // Sessions are rarely closed explicitly in voice mode; a new one supersedes them.
      await c.query(`update sessions set ended_at = now() where ended_at is null`);
      const s = await c.query(`insert into sessions (limit_min) values ($1) returning id::int as id`, [limitMin ?? null]);
      const due = await c.query(
        `select count(*)::int as total,
                count(*) filter (where ${WORD_COUNT_SQL} <= $2)::int as word_mode
           from items where due_on <= $1`,
        [day, WORD_MODE_MAX_WORDS],
      );
      return {
        session_id: s.rows[0].id as number,
        due_count: due.rows[0].total as number,
        due_word_mode: due.rows[0].word_mode as number,
      };
    });
  }

  async endSession(sessionId: number) {
    const day = this.today();
    return this.tx(async (c) => {
      const s = await c.query(
        `update sessions set ended_at = coalesce(ended_at, now()) where id = $1
         returning started_at, ended_at, limit_min`,
        [sessionId],
      );
      if (!s.rows[0]) throw new TutorError(`session ${sessionId} not found`);
      const { started_at, ended_at } = s.rows[0];

      const captured = await c.query(
        `select id::int as id, italian, english, note, source
           from items where last_captured_at between $1 and $2
          order by last_captured_at`,
        [started_at, ended_at],
      );
      const reviewed = await c.query(
        `select i.id::int as id, i.italian, i.english,
                count(*)::int as attempts,
                (array_agg(a.grade order by a.at desc))[1] as last_grade,
                i.due_on as next_due
           from attempts a join items i on i.id = a.item_id
          where a.session_id = $1
          group by i.id
          order by min(a.at)`,
        [sessionId],
      );
      const remaining = await c.query(`select count(*)::int as n from items where due_on <= $1`, [day]);

      const reviewedRows = reviewed.rows.map((r) => compact({ ...r, passed: r.last_grade >= 3 }));
      return {
        session_id: sessionId,
        minutes: Math.round((ended_at.getTime() - started_at.getTime()) / 60000),
        captured: captured.rows.map(compact),
        reviewed: reviewedRows,
        totals: {
          captured: captured.rowCount,
          reviewed: reviewedRows.length,
          passed: reviewedRows.filter((r) => r.passed).length,
          still_due: remaining.rows[0].n as number,
        },
      };
    });
  }

  // ------------------------------------------------------------------- items

  /**
   * Store a gap. An existing item (same Italian, ignoring case) is not
   * duplicated: it is reset to due today with its learning progress cleared.
   * The original context sentence is kept, since that is what makes it stick.
   */
  async captureItem(input: { italian: string; english: string; note?: string; context?: string; source: Source }) {
    const italian = normalizeItalian(input.italian);
    const english = input.english.trim();
    if (!italian) throw new TutorError("italian must not be empty");
    if (!english) throw new TutorError("english must not be empty");

    const { rows } = await this.db.query(
      `insert into items (italian, english, note, context, source, due_on)
       values ($1, $2, $3, $4, $5, $6)
       on conflict ((lower(italian))) do update set
         english = excluded.english,
         note = coalesce(excluded.note, items.note),
         context = coalesce(items.context, excluded.context),
         interval_days = 0,
         repetitions = 0,
         due_on = excluded.due_on,
         last_captured_at = now()
       returning id::int as id, italian, english, note, context, source, due_on, (xmax = 0) as inserted`,
      [italian, english, blankToNull(input.note), blankToNull(input.context), input.source, this.today()],
    );
    const { inserted, ...item } = rows[0];
    return { item: compact(item), status: inserted ? "captured" : "recaptured" };
  }

  /** Due items, oldest due date first, then hardest (lowest ease) first. */
  async dueItems(mode: Mode, limit = 10) {
    const day = this.today();
    const wordOnly = mode === "word";
    const { rows } = await this.db.query(
      `select id::int as id, italian, english, note, context, repetitions, due_on
         from items
        where due_on <= $1 and ($2::bool is false or ${WORD_COUNT_SQL} <= $3)
        order by due_on, ease, id
        limit $4`,
      [day, wordOnly, WORD_MODE_MAX_WORDS, limit],
    );
    const counts = await this.db.query(`select count(*)::int as n from items where due_on <= $1`, [day]);
    const total = counts.rows[0].n as number;
    // The context sentence and note usually contain the answer ("non so perché"),
    // so they travel apart from the prompt, under a name that says when to use them.
    const items = rows.map((r) => {
      const after = compact({ note: r.note, context: r.context });
      return compact({
        id: r.id,
        english: r.english,
        italian: r.italian,
        new: r.repetitions === 0 ? true : undefined,
        due_on: r.due_on,
        after_answer: Object.keys(after).length ? after : undefined,
      });
    });
    const result: Record<string, unknown> = { mode, items, due_total: total };
    if (wordOnly && total > 0) {
      const eligible = await this.db.query(
        `select count(*)::int as n from items where due_on <= $1 and ${WORD_COUNT_SQL} <= $2`,
        [day, WORD_MODE_MAX_WORDS],
      );
      const longer = total - eligible.rows[0].n;
      if (longer > 0) result.held_for_sentence_mode = longer;
    }
    return result;
  }

  /**
   * Everything due, for the drill page: oldest due date first, then hardest.
   * `preview[q]` is the interval in days that grade q would give.
   */
  async drillItems(limit = 200) {
    const day = this.today();
    const { rows } = await this.db.query(
      `select id::int as id, italian, english, note, context, ease, interval_days, repetitions,
              ($1::date - due_on) as overdue, count(*) over ()::int as total
         from items where due_on <= $1
        order by due_on, ease, id
        limit $2`,
      [day, limit],
    );
    const next = await this.db.query(
      `select due_on as day, count(*)::int as count from items where due_on > $1
        group by due_on order by due_on limit 1`,
      [day],
    );
    const items = rows.map((r) => ({
      id: r.id as number,
      italian: r.italian as string,
      english: r.english as string,
      note: r.note as string | null,
      context: r.context as string | null,
      new: r.repetitions === 0,
      overdue: r.overdue as number,
      preview: [0, 1, 2, 3, 4, 5].map((q) => sm2(r, q).interval_days),
    }));
    return {
      today: day,
      items,
      due: (rows[0]?.total as number) ?? 0,
      next: (next.rows[0] as { day: string; count: number } | undefined) ?? null,
    };
  }

  async recordAttempt(input: {
    item_id: number;
    session_id?: number;
    mode: AttemptMode;
    prompt?: string;
    answer: string;
    grade: number;
    fillers: number;
  }) {
    const day = this.today();
    // The transcript is the evidence; never record fewer fillers than it shows.
    const fillers = Math.max(input.fillers, countFillers(input.answer));
    const grade = capGrade(input.grade, fillers);

    return this.tx(async (c) => {
      const it = await c.query(
        `select id, italian, english, ease, interval_days, repetitions from items where id = $1 for update`,
        [input.item_id],
      );
      if (!it.rows[0]) throw new TutorError(`item ${input.item_id} not found`);
      const prev = it.rows[0];

      let sessionId: number | null = input.session_id ?? null;
      if (sessionId !== null) {
        const s = await c.query(`select 1 from sessions where id = $1`, [sessionId]);
        if (!s.rows[0]) sessionId = null;
      }
      // A drill on the screen is not part of a voice session.
      if (sessionId === null && input.mode !== "screen") sessionId = (await this.clock())?.session_id ?? null;

      const next = sm2({ ease: prev.ease, interval_days: prev.interval_days, repetitions: prev.repetitions }, grade);
      const upd = await c.query(
        `update items set ease = $2, interval_days = $3, repetitions = $4, due_on = $5::date + $3::int
          where id = $1 returning due_on`,
        [input.item_id, next.ease, next.interval_days, next.repetitions, day],
      );
      await c.query(
        `insert into attempts (item_id, session_id, mode, prompt, answer, grade, fillers)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [input.item_id, sessionId, input.mode, blankToNull(input.prompt) ?? (input.mode === "screen" ? prev.english : null), blankToNull(input.answer), grade, fillers],
      );

      return compact({
        item_id: input.item_id,
        italian: prev.italian,
        grade,
        grade_capped_from: grade !== input.grade ? input.grade : undefined,
        fillers,
        passed: grade >= 3,
        interval_days: next.interval_days,
        due_on: upd.rows[0].due_on as string,
      });
    });
  }

  async listItems(filter: ListFilter = "due", limit = 50) {
    const day = this.today();
    const where = filter === "due" ? `where due_on <= $1` : filter === "recent" ? `where created_at > now() - interval '14 days'` : ``;
    const order = filter === "due" ? `due_on, ease, id` : filter === "recent" ? `created_at desc` : `lower(italian)`;
    const params: unknown[] = filter === "due" ? [day, limit] : [limit];
    const { rows } = await this.db.query(
      `select id::int as id, italian, english, note, context, source,
              round(ease::numeric, 2)::float as ease, interval_days, repetitions, due_on,
              to_char(created_at, 'YYYY-MM-DD') as created
         from items ${where}
        order by ${order}
        limit $${params.length}`,
      params,
    );
    const total = await this.db.query(`select count(*)::int as n from items`);
    return { filter, items: rows.map(compact), returned: rows.length, total_items: total.rows[0].n as number };
  }

  /**
   * Full-text search over italian, english, note and context (prefix match per
   * word, all words required), with a substring fallback for mid-word matches.
   * Without a query, most recently captured first.
   */
  async searchItems(q: string, filter: ItemFilter = "all", limit = 100) {
    const params: unknown[] = [this.today(), this.timeZone];
    const where: string[] = [];
    let order = "i.last_captured_at desc, i.id desc";
    const terms = searchTerms(q);
    if (terms.length) {
      params.push(terms.map((t) => `${t}:*`).join(" & "));
      const tsq = `to_tsquery('simple', $${params.length})`;
      params.push(`%${foldText(q.trim()).replace(/[\\%_]/g, (c) => "\\" + c)}%`);
      where.push(`(${ITEM_DOC_SQL} @@ ${tsq} or ${ITEM_TEXT_SQL} like $${params.length})`);
      params.push(foldText(q.trim()));
      // An exact match on the Italian first, then best full-text rank.
      order = `(translate(lower(i.italian), '${FOLD_FROM}', '${FOLD_TO}') = $${params.length}) desc, ts_rank(${ITEM_DOC_SQL}, ${tsq}) desc, lower(i.italian)`;
    }
    if (filter === "due") where.push("i.due_on <= $1");
    if (filter === "nocontext") where.push("i.context is null");
    if (filter === "failed") where.push("exists (select 1 from attempts a where a.item_id = i.id and a.grade < 3)");
    params.push(limit);
    const { rows } = await this.db.query(
      `select i.id::int as id, i.italian, i.english, i.note, i.context, i.source,
              round(i.ease::numeric, 2)::float as ease, i.interval_days, i.repetitions, i.due_on,
              (i.due_on <= $1) as due,
              to_char(i.created_at at time zone $2, 'YYYY-MM-DD') as created,
              (select count(*)::int from attempts a where a.item_id = i.id) as attempts,
              (select coalesce(json_agg(h), '[]'::json) from (
                 select to_char(a.at at time zone $2, 'YYYY-MM-DD HH24:MI') as at, a.mode, a.prompt, a.answer, a.grade, a.fillers
                   from attempts a where a.item_id = i.id order by a.at desc limit 10) h) as history,
              count(*) over ()::int as total
         from items i
        ${where.length ? `where ${where.join(" and ")}` : ""}
        order by ${order}
        limit $${params.length}`,
      params,
    );
    return { items: rows.map(({ total, ...r }) => r), total: (rows[0]?.total as number) ?? 0 };
  }

  /** Edit an item's text fields; learning progress is untouched. */
  async updateItem(id: number, f: { italian: string; english: string; note?: string; context?: string; source: string }) {
    const italian = normalizeItalian(f.italian);
    const english = f.english.trim();
    if (!italian || !english) throw new TutorError("Italian and English must not be empty");
    if (!SOURCES.includes(f.source as Source)) throw new TutorError(`unknown source "${f.source}"`);
    try {
      const { rows } = await this.db.query(
        `update items set italian = $2, english = $3, note = $4, context = $5, source = $6 where id = $1 returning italian`,
        [id, italian, english, blankToNull(f.note), blankToNull(f.context), f.source],
      );
      if (!rows[0]) throw new TutorError(`item ${id} not found`);
      return rows[0].italian as string;
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new TutorError(`"${italian}" already exists`);
      throw e;
    }
  }

  /** Make an item due today and start its learning over (ease is kept). */
  async resetItem(id: number) {
    const { rows } = await this.db.query(
      `update items set repetitions = 0, interval_days = 0, due_on = $2 where id = $1 returning italian`,
      [id, this.today()],
    );
    if (!rows[0]) throw new TutorError(`item ${id} not found`);
    return rows[0].italian as string;
  }

  /** Delete an item and its answer history. */
  async deleteItem(id: number) {
    const { rows } = await this.db.query(`delete from items where id = $1 returning italian`, [id]);
    if (!rows[0]) throw new TutorError(`item ${id} not found`);
    return rows[0].italian as string;
  }

  stats() {
    return loadStats(this.db, this.timeZone);
  }

  // ----------------------------------------------------------------- helpers

  private async tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await this.db.connect();
    try {
      await c.query("begin");
      const out = await fn(c);
      await c.query("commit");
      return out;
    } catch (e) {
      await c.query("rollback").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }
}

/** Trim, collapse spaces, drop wrapping quotes and trailing sentence punctuation. */
export function normalizeItalian(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["“”«»]+|["“”«»]+$/g, "") // not ' : "un po'" ends in an apostrophe
    .replace(/[.!?;:,…]+$/u, "")
    .trim();
}

function blankToNull(s: string | undefined | null): string | null {
  const t = s?.trim();
  return t ? t : null;
}

/** Drop null/undefined fields: every token counts in a voice loop. */
function compact<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined)) as T;
}

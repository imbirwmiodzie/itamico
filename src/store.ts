// All tutor state and logic: sessions and the timer, gap capture, due items,
// attempts and SM-2 scheduling. The MCP layer in tools.ts is a thin wrapper.

import type pg from "pg";
import type { Db } from "./db.js";
import { today } from "./db.js";
import { capGrade, countFillers, sm2 } from "./grading.js";

export type Mode = "word" | "sentence";
export type Source = "asked" | "fallback" | "error" | "topic_check";
export type ListFilter = "due" | "recent" | "all";

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
    const items = rows.map(({ repetitions, ...r }) => compact({ ...r, new: repetitions === 0 ? true : undefined }));
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

  async recordAttempt(input: {
    item_id: number;
    session_id?: number;
    mode: Mode;
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
        `select id, italian, ease, interval_days, repetitions from items where id = $1 for update`,
        [input.item_id],
      );
      if (!it.rows[0]) throw new TutorError(`item ${input.item_id} not found`);
      const prev = it.rows[0];

      let sessionId: number | null = input.session_id ?? null;
      if (sessionId !== null) {
        const s = await c.query(`select 1 from sessions where id = $1`, [sessionId]);
        if (!s.rows[0]) sessionId = null;
      }
      if (sessionId === null) sessionId = (await this.clock())?.session_id ?? null;

      const next = sm2({ ease: prev.ease, interval_days: prev.interval_days, repetitions: prev.repetitions }, grade);
      const upd = await c.query(
        `update items set ease = $2, interval_days = $3, repetitions = $4, due_on = $5::date + $3::int
          where id = $1 returning due_on`,
        [input.item_id, next.ease, next.interval_days, next.repetitions, day],
      );
      await c.query(
        `insert into attempts (item_id, session_id, mode, prompt, answer, grade, fillers)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [input.item_id, sessionId, input.mode, blankToNull(input.prompt), input.answer, grade, fillers],
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

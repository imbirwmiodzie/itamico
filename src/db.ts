import { readFile } from "node:fs/promises";
import pg from "pg";

// Return DATE columns as plain 'YYYY-MM-DD' strings instead of JS Dates at
// local midnight, which shift by a day depending on the host's zone.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export type Db = pg.Pool;

export function createPool(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: 4, idleTimeoutMillis: 30_000 });
  // An idle client dropped by the provider (Neon scale-to-zero, pooler restarts)
  // must not crash the process.
  pool.on("error", (err) => console.error("pg pool error:", err.message));
  return pool;
}

export async function migrate(db: Db): Promise<void> {
  const sql = await readFile(new URL("../sql/schema.sql", import.meta.url), "utf8");
  await db.query(sql);
}

/** Today's date in the user's time zone, as 'YYYY-MM-DD'. */
export function today(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

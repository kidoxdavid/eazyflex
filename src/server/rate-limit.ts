import { sql } from "drizzle-orm";
import { db } from "./db/client";

/** Fixed-window limiter backed by Postgres so it works across instances. Returns true if allowed. */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const res = await db.execute(sql`
    INSERT INTO rate_limits (key, count, window_start) VALUES (${key}, 1, now())
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) THEN 1 ELSE rate_limits.count + 1 END,
      window_start = CASE WHEN rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) THEN now() ELSE rate_limits.window_start END
    RETURNING count`);
  return Number((res.rows[0] as { count: number }).count) <= limit;
}

/** Read-only: is this key still under its limit? (Does not count an attempt.) Pair with rateLimit() on *failures* only. */
export async function rateLimitAllowed(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const res = await db.execute(sql`select count from rate_limits where key = ${key} and window_start > now() - make_interval(secs => ${windowSeconds})`);
  const row = res.rows[0] as { count: number } | undefined;
  return !row || Number(row.count) < limit;
}

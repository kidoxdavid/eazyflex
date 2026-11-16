import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { log } from "@/server/monitoring";
export const dynamic = "force-dynamic";
/** Readiness: can this instance serve traffic? Checks the database and that migrations have been applied. Reveals no internals. */
export async function GET() {
  try {
    const r = await db.execute(sql`select (select count(*)::int from drizzle.__drizzle_migrations) as migrations, (select count(*)::int from users) as users`);
    const row = r.rows[0] as { migrations: number };
    if (!row || Number(row.migrations) < 1) return NextResponse.json({ status: "not_ready", reason: "migrations" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ status: "ready" }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    log.error("readiness check failed", { error: (e as Error).message });
    return NextResponse.json({ status: "not_ready", reason: "database" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

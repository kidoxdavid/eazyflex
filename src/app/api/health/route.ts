import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
/** Liveness: the process is up. Intentionally touches nothing else, so a database outage doesn't make the orchestrator restart healthy web servers. */
export function GET() { return NextResponse.json({ status: "ok", release: process.env.APP_RELEASE ?? process.env.GIT_SHA ?? "dev" }, { headers: { "Cache-Control": "no-store" } }); }

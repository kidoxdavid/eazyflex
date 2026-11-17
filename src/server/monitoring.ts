import { createHash, randomUUID } from "node:crypto";

/**
 * Structured logging + error reporting.
 *  - Every log line is one JSON object on stdout/stderr (ship it to any log aggregator).
 *  - Errors are also forwarded to a Sentry-compatible ingest endpoint when SENTRY_DSN is set. This is a deliberately small
 *    reporter (envelope POST, no tracing/source maps); swap in @sentry/nextjs if you need those. Reporting never throws and never blocks a request.
 *  - Personal data is scrubbed before anything leaves the process: emails, phone numbers, bearer/session tokens, and any field named like a secret.
 */
type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level | "silent", number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const SECRET_KEY = /pass(word)?|secret|token|authorization|cookie|session|otp|totp|recovery|api[-_]?key|dsn|card|iban/i;

export function scrubString(s: string): string {
  return s
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/(?<![\w-])(?:\+?\d[\s().-]{0,2}){9,}\d(?![\w-])/g, "[number]")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [redacted]")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[token]");
}
export function scrub(v: unknown, depth = 0): unknown {
  if (v == null || depth > 4) return v ?? null;
  if (typeof v === "string") return scrubString(v);
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof Error) return { name: v.name, message: scrubString(v.message) };
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => scrub(x, depth + 1));
  if (typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).slice(0, 40).map(([k, x]) => [k, SECRET_KEY.test(k) ? "[redacted]" : scrub(x, depth + 1)]));
  return String(v);
}

const minLevel = (): Level | "silent" => ((process.env.LOG_LEVEL as Level) in ORDER ? (process.env.LOG_LEVEL as Level) : "info");
function emit(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  if (ORDER[level] < ORDER[minLevel()]) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg: scrubString(msg), service: "eazyflex", env: process.env.NODE_ENV, ...(scrub(fields) as object) });
  (level === "error" || level === "warn" ? process.stderr : process.stdout).write(line + "\n");
}
export const log = { debug: (m: string, f?: Record<string, unknown>) => emit("debug", m, f), info: (m: string, f?: Record<string, unknown>) => emit("info", m, f), warn: (m: string, f?: Record<string, unknown>) => emit("warn", m, f), error: (m: string, f?: Record<string, unknown>) => emit("error", m, f) };

// ---- Sentry-compatible reporting ----
export function parseDsn(dsn: string | undefined) {
  if (!dsn) return null;
  try { const u = new URL(dsn); const projectId = u.pathname.replace(/^\/+/, ""); if (!u.username || !projectId) return null; return { key: u.username, endpoint: `${u.protocol}//${u.host}/api/${projectId}/envelope/`, dsn }; } catch { return null; }
}
const seen = new Map<string, { at: number; n: number }>();
const WINDOW_MS = 60_000, MAX_PER_WINDOW = 5, MAX_TOTAL_PER_WINDOW = 50; let totalWindow = { at: 0, n: 0 };

/** Drop repeats of the same error (and cap volume) so an outage can't flood the reporting service or your quota. */
export function shouldReport(fingerprint: string, now = Date.now()) {
  if (now - totalWindow.at > WINDOW_MS) totalWindow = { at: now, n: 0 };
  if (totalWindow.n >= MAX_TOTAL_PER_WINDOW) return false;
  const s = seen.get(fingerprint);
  if (!s || now - s.at > WINDOW_MS) { seen.set(fingerprint, { at: now, n: 1 }); totalWindow.n++; return true; }
  if (s.n >= MAX_PER_WINDOW) return false;
  s.n++; totalWindow.n++; return true;
}
export const _resetReportingState = () => { seen.clear(); totalWindow = { at: 0, n: 0 }; };

export type ErrorContext = { requestId?: string; route?: string; method?: string; userId?: string; extra?: Record<string, unknown> };

export function buildEvent(err: unknown, ctx: ErrorContext = {}) {
  const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : "Non-error thrown");
  const frames = (e.stack ?? "").split("\n").slice(1, 30).map((l) => l.trim()).filter((l) => l.startsWith("at ")).map((l) => { const m = l.match(/^at (?:(.*?) \()?(.*?):(\d+):(\d+)\)?$/); return m ? { function: m[1] ?? "<anonymous>", filename: scrubString(m[2]), lineno: Number(m[3]), colno: Number(m[4]) } : { function: scrubString(l) }; }).reverse();
  const eventId = randomUUID().replace(/-/g, "");
  return {
    event_id: eventId, timestamp: Date.now() / 1000, level: "error", platform: "node", server_name: undefined,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown", release: process.env.APP_RELEASE ?? process.env.GIT_SHA ?? undefined,
    exception: { values: [{ type: e.name, value: scrubString(e.message), stacktrace: { frames } }] },
    tags: { route: ctx.route ? scrubString(ctx.route.split("?")[0]) : undefined, method: ctx.method },
    // Only an opaque user id — never name, email or request bodies.
    user: ctx.userId ? { id: ctx.userId } : undefined, request_id: ctx.requestId, extra: ctx.extra ? scrub(ctx.extra) : undefined,
  };
}
export function buildEnvelope(event: ReturnType<typeof buildEvent>, dsn: string) {
  return [JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString(), dsn }), JSON.stringify({ type: "event" }), JSON.stringify(event)].join("\n");
}

export async function captureException(err: unknown, ctx: ErrorContext = {}): Promise<void> {
  const e = err instanceof Error ? err : new Error(String(err));
  const fingerprint = createHash("sha1").update(`${e.name}|${scrubString(e.message)}|${ctx.route ?? ""}`).digest("hex");
  log.error(`${e.name}: ${e.message}`, { requestId: ctx.requestId, route: ctx.route?.split("?")[0], method: ctx.method, stack: (e.stack ?? "").split("\n").slice(1, 8).join(" | ") });
  const dsn = parseDsn(process.env.SENTRY_DSN);
  if (!dsn || !shouldReport(fingerprint)) return;
  try {
    const ev = buildEvent(e, ctx);
    const res = await fetch(dsn.endpoint, { method: "POST", headers: { "Content-Type": "application/x-sentry-envelope", "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${dsn.key}, sentry_client=eazyflex/1.0` }, body: buildEnvelope(ev, dsn.dsn), signal: AbortSignal.timeout(2000) });
    if (!res.ok) log.warn("error reporting rejected", { status: res.status });
  } catch (re) { log.warn("error reporting failed", { error: (re as Error).message }); } // reporting must never break a request
}

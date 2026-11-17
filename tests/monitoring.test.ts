import http from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { _resetReportingState, buildEnvelope, buildEvent, captureException, log, parseDsn, scrub, scrubString, shouldReport } from "@/server/monitoring";
import { GET as health } from "@/app/api/health/route";
import { GET as ready } from "@/app/api/ready/route";
import { db } from "@/server/db/client";
import { closeDb, freshDb } from "./helpers";

beforeAll(freshDb);
afterAll(closeDb);

describe("scrubbing", () => {
  it("removes emails, phone numbers, bearer tokens and long opaque tokens from strings", () => {
    expect(scrubString("failed for jane.doe+x@example.com")).toBe("failed for [email]");
    expect(scrubString("call 403-555-0100 or +1 (403) 555 0199")).toBe("call [number] or [number]");
    expect(scrubString("Authorization: Bearer abcdefghijklmnop1234")).toBe("Authorization: Bearer [redacted]");
    expect(scrubString("token=" + "a".repeat(43))).toContain("[token]");
    expect(scrubString("Opportunity 12 for 3 hours at $35")).toBe("Opportunity 12 for 3 hours at $35"); // ordinary text and short numbers survive
  });
  it("redacts secret-looking keys at any depth and truncates big structures", () => {
    const out: any = scrub({ user: "x@y.com", password: "hunter2", nested: { sessionToken: "abc", ok: "fine", cookie: "c" }, list: Array.from({ length: 50 }, (_, i) => i) });
    expect(out.user).toBe("[email]"); expect(out.password).toBe("[redacted]"); expect(out.nested.sessionToken).toBe("[redacted]"); expect(out.nested.cookie).toBe("[redacted]"); expect(out.nested.ok).toBe("fine"); expect(out.list).toHaveLength(20);
  });
});

describe("DSN, event and envelope", () => {
  it("parses a DSN and rejects malformed ones", () => {
    expect(parseDsn("https://abc123@o1.ingest.sentry.io/4507")).toMatchObject({ key: "abc123", endpoint: "https://o1.ingest.sentry.io/api/4507/envelope/" });
    for (const bad of [undefined, "", "not a url", "https://host/4507", "https://key@host/"]) expect(parseDsn(bad)).toBeNull();
  });
  it("builds an event with a parsed stack, only an opaque user id, and no personal data", () => {
    const err = new Error("could not email jane@example.com about 403-555-0100"); const ev = buildEvent(err, { userId: "u-1", route: "/business/post?token=secret", method: "POST", requestId: "r-1" });
    const json = JSON.stringify(ev);
    expect(json).not.toMatch(/jane@example\.com|403-555-0100|token=secret/); expect(ev.user).toEqual({ id: "u-1" }); expect(ev.tags.route).toBe("/business/post"); expect(ev.request_id).toBe("r-1");
    expect(ev.exception.values[0].stacktrace.frames.length).toBeGreaterThan(0); expect(ev.exception.values[0].type).toBe("Error");
    const env = buildEnvelope(ev, "https://k@h/1").split("\n"); expect(env).toHaveLength(3); expect(JSON.parse(env[1])).toEqual({ type: "event" }); expect(JSON.parse(env[2]).event_id).toBe(ev.event_id);
  });
});

describe("reporting to an ingest endpoint", () => {
  let server: http.Server; let port = 0; const received: { url: string; auth: string; body: string }[] = []; let mode: "ok" | "500" = "ok";
  beforeAll(async () => {
    server = http.createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { received.push({ url: req.url!, auth: String(req.headers["x-sentry-auth"]), body: b }); res.statusCode = mode === "ok" ? 200 : 500; res.end("{}"); }); });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r)); port = (server.address() as any).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  afterEach(() => { received.length = 0; mode = "ok"; _resetReportingState(); delete process.env.SENTRY_DSN; vi.restoreAllMocks(); });

  it("posts a scrubbed envelope to /api/<project>/envelope/ with the key, and is silent when no DSN is set", async () => {
    await captureException(new Error("noop"), {}); expect(received).toHaveLength(0);
    process.env.SENTRY_DSN = `http://pub123@127.0.0.1:${port}/42`;
    await captureException(new Error("payment for jane@example.com failed"), { route: "/worker/apply", userId: "u-9" });
    expect(received).toHaveLength(1); const r = received[0];
    expect(r.url).toBe("/api/42/envelope/"); expect(r.auth).toMatch(/sentry_key=pub123/);
    const [hdr, item, ev] = r.body.split("\n").map((l) => JSON.parse(l)); expect(hdr.dsn).toContain("pub123"); expect(item.type).toBe("event");
    expect(JSON.stringify(ev)).not.toContain("jane@example.com"); expect(ev.exception.values[0].value).toBe("payment for [email] failed");
  });
  it("de-duplicates identical errors and caps total volume", async () => {
    process.env.SENTRY_DSN = `http://k@127.0.0.1:${port}/1`;
    for (let i = 0; i < 12; i++) await captureException(new Error("same failure"), { route: "/x" });
    expect(received.length).toBe(5);
    expect(shouldReport("a-new-fingerprint")).toBe(true);
  });
  it("never throws or blocks when the service is down or rejects", async () => {
    process.env.SENTRY_DSN = `http://k@127.0.0.1:1/1`; // nothing listens on port 1
    await expect(captureException(new Error("while down"), {})).resolves.toBeUndefined();
    process.env.SENTRY_DSN = `http://k@127.0.0.1:${port}/1`; mode = "500";
    await expect(captureException(new Error("while rejecting"), {})).resolves.toBeUndefined();
  });
  it("logs one JSON object per line with sensitive values redacted", () => {
    process.env.LOG_LEVEL = "error"; const lines: string[] = []; vi.spyOn(process.stderr, "write").mockImplementation(((s: string) => { lines.push(s); return true; }) as any);
    log.error("login failed for bob@example.com", { password: "pw", requestId: "r-7" });
    process.env.LOG_LEVEL = "silent"; const o = JSON.parse(lines[0]); expect(o).toMatchObject({ level: "error", service: "eazyflex", requestId: "r-7", password: "[redacted]" }); expect(o.msg).toBe("login failed for [email]"); expect(typeof o.ts).toBe("string");
  });
});

describe("health endpoints", () => {
  it("liveness answers without touching the database", async () => { const r = await health(); expect(r.status).toBe(200); expect((await r.json()).status).toBe("ok"); expect(r.headers.get("cache-control")).toBe("no-store"); });
  it("readiness is 200 when the database and migrations are fine, 503 (with only a coarse reason) when not", async () => {
    const ok = await ready(); expect(ok.status).toBe(200); expect(await ok.json()).toEqual({ status: "ready" });
    vi.spyOn(db, "execute").mockRejectedValueOnce(new Error("connect ECONNREFUSED 10.0.0.5:5432 password=hunter2"));
    const bad = await ready(); expect(bad.status).toBe(503); const body = await bad.json(); expect(body).toEqual({ status: "not_ready", reason: "database" }); expect(JSON.stringify(body)).not.toMatch(/10\.0\.0\.5|hunter2/);
  });
});

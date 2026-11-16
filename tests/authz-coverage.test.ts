// Static guards over the source tree. They don't prove the code is secure, but they make the most common authorisation mistakes —
// a new server action or route that forgets to check who is calling — fail the build instead of shipping.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..", "src");
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const files = walk(ROOT); const read = (f: string) => fs.readFileSync(f, "utf8");
const rel = (f: string) => path.relative(ROOT, f);

/** Splits a module into its exported async functions: { name, body }. */
function exportedAsync(src: string) {
  const re = /export async function (\w+)\s*\(/g; const hits: { name: string; start: number }[] = []; let m;
  while ((m = re.exec(src))) hits.push({ name: m[1], start: m.index });
  return hits.map((h, i) => ({ name: h.name, body: src.slice(h.start, hits[i + 1]?.start ?? src.length) }));
}

const GUARD = /requireUser\(|requireAdmin\(|getCurrentUser\(|getSessionContext\(|\bactor\(\)|\bbiz\(\)/; // actor()/biz() are local helpers verified below
// Public by design (they ARE the authentication boundary) or purely redirect-only.
const PUBLIC_ACTIONS = new Set(["registerAction", "loginAction", "forgotPasswordAction", "resetPasswordAction", "verifyEmailAction", "logoutAction"]);

describe("every server action authenticates its caller", () => {
  const actionFiles = files.filter((f) => rel(f).startsWith(path.join("app", "actions")) && f.endsWith(".ts") && !f.endsWith("util.ts"));
  it("found the action files", () => expect(actionFiles.length).toBeGreaterThanOrEqual(8));
  for (const f of actionFiles) {
    const src = read(f);
    if (!src.startsWith('"use server"')) continue;
    for (const fn of exportedAsync(src)) {
      it(`${rel(f)} › ${fn.name}`, () => {
        if (PUBLIC_ACTIONS.has(fn.name)) return;
        expect(GUARD.test(fn.body), `${fn.name} must call requireUser/requireAdmin/getCurrentUser before doing anything`).toBe(true);
      });
    }
    it(`${rel(f)} exports only async functions (anything exported from a "use server" file is a public endpoint)`, () => {
      expect(/export (const|let|var|class|default|type\s+\w+\s*=\s*\{)/.test(src.replace(/export type [^\n]*/g, ""))).toBe(false);
    });
  }
});

describe("local auth helpers used by actions really authenticate", () => {
  it("admin.ts actor() and business.ts biz() call requireUser", () => {
    const adm = read(path.join(ROOT, "app", "actions", "admin.ts")), biz = read(path.join(ROOT, "app", "actions", "business.ts"));
    expect(/const actor = async \(\) => \{ const u = await requireUser\("admin"\)/.test(adm)).toBe(true);
    expect(/async function biz\(\) \{\s*const u = await requireUser\("business"\)/.test(biz)).toBe(true);
  });
});

describe("route handlers", () => {
  const routes = files.filter((f) => /route\.ts$/.test(f));
  const PUBLIC = new Set([path.join("app", "api", "health", "route.ts"), path.join("app", "api", "ready", "route.ts")]);
  it("every route handler authenticates unless explicitly public (health/readiness only)", () => {
    expect(routes.length).toBeGreaterThanOrEqual(4);
    for (const f of routes) if (!PUBLIC.has(rel(f))) expect(GUARD.test(read(f)), `${rel(f)} must authenticate`).toBe(true);
  });
  it("state-changing routes accept POST only", () => { expect(/export (async )?function (PUT|PATCH|DELETE)/.test(read(path.join(ROOT, "app", "account", "export", "route.ts")))).toBe(false); expect(read(path.join(ROOT, "app", "account", "export", "route.ts"))).toMatch(/export async function POST/); });
});

describe("portal layouts enforce the right account kind", () => {
  const cases: [string, RegExp][] = [["app/worker/layout.tsx", /requireUser\("worker"\)/], ["app/business/layout.tsx", /requireUser\("business"\)/], ["app/admin/layout.tsx", /requireUser\("admin"\)/]];
  for (const [f, re] of cases) it(f, () => expect(re.test(read(path.join(ROOT, f)))).toBe(true));
  it("only the MFA pages may skip the MFA gate", () => {
    const skippers = files.filter((f) => /skipMfa:\s*true/.test(read(f))).map(rel).sort();
    expect(skippers).toEqual([path.join("app", "(auth)", "mfa", "page.tsx"), path.join("app", "(auth)", "mfa", "recovery-codes", "page.tsx"), path.join("app", "actions", "mfa.ts")].sort());
  });
  it("every admin page re-checks its specific permission (not just 'is an admin')", () => {
    const pages = files.filter((f) => rel(f).startsWith(path.join("app", "admin")) && f.endsWith("page.tsx"));
    expect(pages.length).toBeGreaterThanOrEqual(8);
    for (const f of pages) expect(/requireAdmin\(|requireUser\("admin"\)/.test(read(f)), `${rel(f)} must call requireAdmin/requireUser`).toBe(true);
  });
});

describe("service-layer authorisation for privileged operations", () => {
  const checkAll = (file: string, exempt: string[]) => {
    const fns = exportedAsync(read(path.join(ROOT, "server", "services", file))).filter((f) => !exempt.includes(f.name));
    expect(fns.length).toBeGreaterThan(0);
    for (const fn of fns) expect(/assertCan\(/.test(fn.body), `${file} › ${fn.name} must call assertCan`).toBe(true);
  };
  it("admin.ts: every exported operation checks a permission (helpers exempt)", () => checkAll("admin.ts", ["assertCan", "applicationsCount"]));
  it("moderation.ts: admin operations check a permission; the user-facing report endpoint is exempt", () => checkAll("moderation.ts", ["reportReview"]));
  it("mfa.ts: the only admin-on-admin operation (reset) requires admins.manage", () => { const b = exportedAsync(read(path.join(ROOT, "server", "services", "mfa.ts"))).find((f) => f.name === "resetMfa")!; expect(/assertCan\(actor, "admins\.manage"\)/.test(b.body)).toBe(true); });
});

describe("dangerous constructs stay out of the code base", () => {
  const code = files.filter((f) => /\.(ts|tsx)$/.test(f));
  const offenders = (re: RegExp, allow: string[] = []) => code.filter((f) => re.test(read(f)) && !allow.includes(rel(f))).map(rel);
  it("no string-built SQL (sql.raw) in application code", () => expect(offenders(/sql\.raw\(/)).toEqual([]));
  it("no eval / Function constructor / child_process in application code", () => expect(offenders(/\beval\(|new Function\(|child_process/)).toEqual([]));
  it("dangerouslySetInnerHTML only for the nonce'd JSON-LD block", () => expect(offenders(/dangerouslySetInnerHTML/, [path.join("app", "(public)", "opportunities", "[id]", "page.tsx")])).toEqual([]));
  it("the JSON-LD block escapes '<' and carries the CSP nonce", () => { const s = read(path.join(ROOT, "app", "(public)", "opportunities", "[id]", "page.tsx")); expect(s).toMatch(/replace\(\/<\/g, "\\\\u003c"\)/); expect(s).toMatch(/nonce=\{nonce\}/); });
  it("no secrets or tokens are logged with console.*", () => expect(offenders(/console\.(log|error|warn)\([^)]*(password|token|secret)/i)).toEqual([]));
  it("cookies are only set in the audited places", () => expect(offenders(/\.cookies\(\)|cookies\(\)\)\.set|\.set\(COOKIE|jar\.set/, [path.join("server", "auth", "session.ts"), path.join("server", "auth", "recovery-handoff.ts")]).filter((f) => !/headers\(|getSessionContext|requireUser|getCurrentUser|layout|page|route|middleware|proxy/.test(f))).toEqual([]));
});

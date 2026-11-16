// Captures documentation screenshots of the real running app (demo data only) into docs/screenshots/.
// Prereq: seeded DB + `npm run db:demo-activity`, app running in production mode (next start) — see README.
import { createRequire } from "node:module";
import { createHmac } from "node:crypto";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require("playwright"); } catch { return require(require("node:child_process").execSync("npm root -g").toString().trim() + "/playwright"); } })();
const BASE = process.env.BASE_URL ?? "http://localhost:3100"; const OUT = "docs/screenshots"; fs.mkdirSync(OUT, { recursive: true });
const b32 = (str) => { let bits = 0, v = 0; const out = []; for (const ch of str) { v = (v << 5) | "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(ch); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
const code = (step) => { const m = Buffer.alloc(8); m.writeBigUInt64BE(BigInt(step)); const h = createHmac("sha1", b32("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP")).update(m).digest(); const o = h[h.length - 1] & 15; return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0"); };
const browser = await chromium.launch();
const DESK = { width: 1280, height: 860 }, MOB = { width: 390, height: 844 };
async function open(viewport, login) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 }); const p = await ctx.newPage(); p.setDefaultTimeout(10000);
  if (login) { await p.goto(`${BASE}/sign-in`); await p.fill("#email", login.email); await p.fill("#password", "DemoPass2026!"); await p.click("button:has-text('Sign in')");
    if (login.admin) { await p.waitForURL(/\/mfa/); await p.fill("#code", code(Math.floor(Date.now() / 30000) - 1 + (login.offset ?? 0))); await p.click("button:has-text('Verify')"); await p.waitForURL(/\/admin/); } else await p.waitForURL((u) => !/sign-in/.test(u.pathname)); }
  return p;
}
const shot = async (p, name, path, opts = {}) => { if (path) await p.goto(path.startsWith("http") ? path : BASE + path); await p.waitForLoadState("networkidle").catch(() => {}); if (opts.before) await opts.before(p); await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: !!opts.full, clip: opts.full ? undefined : undefined }); console.log("saved", name); };

const anon = await open(DESK);
await shot(anon, "01-home", "/");
await shot(anon, "02-opportunities", "/opportunities?arrangement=remote");
const href = await anon.locator("a:has-text('View & apply')").first().getAttribute("href");
await shot(anon, "03-opportunity-detail", href);
await shot(anon, "04-register", "/register?type=worker");
await anon.context().close();

const w = await open(DESK, { email: "priya@demo.test" });
await shot(w, "10-worker-overview", "/worker");
await shot(w, "11-worker-recommended", "/worker/recommended");
await shot(w, "12-worker-availability", "/worker/availability");
await shot(w, "13-worker-assignment-recurring", "/worker/assignments", { before: async (p) => { await p.click("a:has-text('Tenant communications')"); await p.waitForSelector("text=Renewal offer"); } });
await shot(w, "14-worker-account-data", "/worker/account");
await w.context().close();

const b = await open(DESK, { email: "owner@maple.demo.test" });
await shot(b, "20-business-overview", "/business");
await shot(b, "21-business-post-work", "/business/post?type=recurring");
await shot(b, "22-business-applicants", "/business", { before: async (p) => { await p.click("a:has-text('Bookkeeping catch-up')"); await p.waitForSelector("text=Applications"); } });
await shot(b, "23-business-shared-coverage", "/business", { before: async (p) => { await p.click("a:has-text('Shared customer support desk')"); await p.click("a:has-text('Shared coverage')"); await p.waitForSelector("text=Required per week"); } });
await shot(b, "24-business-team", "/business/team");
await b.context().close();

const bm = await open(DESK, { email: "owner@pixelcart.demo.test" });
await shot(bm, "25-business-messages", "/business/messages", { before: async (p) => { await p.click("a:has-text('Sam')"); await p.waitForSelector("text=Conversation between"); } });
await bm.context().close();

const a = await open(DESK, { email: "admin@demo.test", admin: true, offset: 0 });
await shot(a, "30-admin-dashboard", "/admin");
await shot(a, "31-admin-matching-rules", "/admin/matching");
await shot(a, "32-admin-audit-log", "/admin/audit");
await a.context().close();
const e = await open(DESK, { email: "moderator@demo.test", admin: true, offset: 0 });
await shot(e, "33-admin-reports-queue", "/admin/reports"); await e.context().close();

const mw = await open(MOB, { email: "priya@demo.test" });
await shot(mw, "40-mobile-recommended", "/worker/recommended");
await shot(mw, "41-mobile-availability", "/worker/availability");
await mw.context().close();
const mb = await open(MOB, { email: "owner@maple.demo.test" });
await shot(mb, "42-mobile-coverage", "/business", { before: async (p) => { await p.click("a:has-text('Shared customer support desk')"); await p.click("a:has-text('Shared coverage')"); await p.waitForSelector("text=Required per week"); } });
await mb.context().close();
const am = await open(MOB); await shot(am, "43-mobile-home", "/"); await am.context().close();
await browser.close();

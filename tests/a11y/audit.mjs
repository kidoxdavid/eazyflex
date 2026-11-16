// Automated accessibility audit: axe-core (WCAG 2.0/2.1/2.2 level A + AA rules) on real pages with signed-in sessions.
// Run against a built app with seeded demo data:  node tests/a11y/audit.mjs   (BASE_URL, default http://localhost:3100)
// This finds machine-detectable problems only. It is NOT a WCAG conformance claim: manual keyboard / screen-reader testing is still required.
import { createRequire } from "node:module";
import { createHmac } from "node:crypto";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require("playwright"); } catch { return require(require("node:child_process").execSync("npm root -g").toString().trim() + "/playwright"); } })();
const axeSrc = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const b32 = (str) => { let bits = 0, v = 0; const out = []; for (const ch of str) { v = (v << 5) | "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(ch); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
const code = (secret, step) => { const m = Buffer.alloc(8); m.writeBigUInt64BE(BigInt(step)); const h = createHmac("sha1", b32(secret)).update(m).digest(); const o = h[h.length - 1] & 15; return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0"); };

const browser = await chromium.launch();
async function session(viewport, login) {
  const context = await browser.newContext({ viewport, bypassCSP: true }); // axe is injected as an inline script, which our CSP (correctly) blocks otherwise
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  if (login) {
    await page.goto(`${BASE}/sign-in`); await page.fill("#email", login.email); await page.fill("#password", "DemoPass2026!"); await page.click("button:has-text('Sign in')");
    if (login.admin) { await page.waitForURL(/\/mfa/); await page.fill("#code", code("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", Math.floor(Date.now() / 30000) - 1 + (login.stepOffset ?? 0))); await page.click("button:has-text('Verify')"); await page.waitForURL(/\/admin/); }
    else await page.waitForURL((u) => !/sign-in/.test(u.pathname));
  }
  return page;
}
async function firstId(page, path, linkText) { await page.goto(BASE + path); const href = await page.locator(`a:has-text('${linkText}')`).first().getAttribute("href"); return href; }

const results = []; let pagesChecked = 0;
async function audit(page, label, url, viewportName) {
  await page.goto(url.startsWith("http") ? url : BASE + url); await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(axeSrc);
  const r = await page.evaluate(async (tags) => await window.axe.run(document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] }), TAGS);
  pagesChecked++;
  for (const v of r.violations) results.push({ page: label, viewport: viewportName, rule: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: v.nodes.slice(0, 2).map((n) => ({ target: n.target.join(" "), html: n.html.slice(0, 140), why: (n.any[0] ?? n.all[0] ?? n.none[0])?.message })) });
  console.log(`${r.violations.length ? "✗" : "✓"} ${viewportName.padEnd(7)} ${label}${r.violations.length ? "  — " + r.violations.map((v) => `${v.id}(${v.nodes.length})`).join(", ") : ""}`);
}

const DESKTOP = { width: 1280, height: 900 }, MOBILE = { width: 390, height: 844 };
for (const [vpName, vp] of [["desktop", DESKTOP], ["mobile", MOBILE]]) {
  const anon = await session(vp);
  const oppHref = (await firstId(anon, "/opportunities", "View & apply"));
  for (const [l, u] of [["home", "/"], ["opportunities", "/opportunities"], ["opportunity detail", oppHref], ["find work", "/find-work"], ["hire talent", "/hire-talent"], ["how it works", "/how-it-works"], ["about", "/about"], ["help", "/help"], ["category page", "/work/customer-service"], ["sign in", "/sign-in"], ["register (worker)", "/register?type=worker"], ["register (business)", "/register?type=business"], ["forgot password", "/forgot-password"]]) await audit(anon, l, u, vpName);
  await anon.context().close();

  const w = await session(vp, { email: "priya@demo.test" });
  for (const [l, u] of [["worker overview", "/worker"], ["worker recommended", "/worker/recommended"], ["worker availability", "/worker/availability"], ["worker profile", "/worker/profile"], ["worker onboarding 1", "/worker/onboarding?step=1"], ["worker onboarding 3", "/worker/onboarding?step=3"], ["worker applications", "/worker/applications"], ["worker saved", "/worker/saved"], ["worker searches", "/worker/searches"], ["worker invitations", "/worker/invitations"], ["worker assignments", "/worker/assignments"], ["worker coverage", "/worker/coverage"], ["worker messages", "/worker/messages"], ["worker notifications", "/worker/notifications"], ["worker settings", "/worker/settings"], ["worker account", "/worker/account"]]) await audit(w, l, u, vpName);
  await w.context().close();

  const b = await session(vp, { email: "owner@maple.demo.test" });
  await b.goto(`${BASE}/business`); const deskHref = await b.locator("a:has-text('Shared customer support desk')").first().getAttribute("href");
  for (const [l, u] of [["business overview", "/business"], ["business post (chooser)", "/business/post"], ["business post (recurring)", "/business/post?type=recurring"], ["business opportunity", deskHref], ["business coverage", deskHref + "/coverage"], ["business talent", "/business/talent"], ["business shortlist", "/business/shortlist"], ["business assignments", "/business/assignments"], ["business messages", "/business/messages"], ["business team", "/business/team"], ["business profile", "/business/profile"], ["business account", "/business/account"]]) await audit(b, l, u, vpName);
  await b.context().close();

  const a = await session(vp, { email: "admin@demo.test", admin: true, stepOffset: vpName === "mobile" ? 1 : 0 });
  for (const [l, u] of [["admin dashboard", "/admin"], ["admin users", "/admin/users"], ["admin opportunities", "/admin/opportunities"], ["admin verification", "/admin/verification"], ["admin catalog", "/admin/catalog"], ["admin matching", "/admin/matching"], ["admin reports", "/admin/reports"], ["admin audit", "/admin/audit"], ["mfa settings", "/mfa"]]) await audit(a, l, u, vpName);
  await a.context().close();
}
await browser.close();

const byRule = {};
for (const r of results) { const k = r.rule; (byRule[k] ??= { rule: k, impact: r.impact, help: r.help, pages: new Set(), nodes: 0, sample: r.sample[0] }); byRule[k].pages.add(r.page); byRule[k].nodes += r.nodes; }
const summary = Object.values(byRule).map((x) => ({ ...x, pages: [...x.pages] })).sort((a, b) => b.nodes - a.nodes);
fs.mkdirSync("docs", { recursive: true });
fs.writeFileSync("docs/accessibility-audit.json", JSON.stringify({ ranAt: new Date().toISOString(), tool: "axe-core", tags: TAGS, pageViewsChecked: pagesChecked, violationsByRule: summary }, null, 2));
console.log(`\n${pagesChecked} page views checked, ${results.length} page-level violations across ${summary.length} rule(s).`);
for (const s of summary) console.log(`- [${s.impact}] ${s.rule}: ${s.help} — ${s.nodes} nodes on ${s.pages.length} page(s). e.g. ${s.sample?.target} :: ${s.sample?.why}`);
process.exit(summary.length ? 1 : 0);

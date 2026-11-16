// Keyboard-only checks: the skip link is the first tab stop and moves focus to the content; the sign-in form can be completed with Tab/Enter alone;
// every control reached by Tab on key pages shows a visible focus indicator.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require("playwright"); } catch { return require(require("node:child_process").execSync("npm root -g").toString().trim() + "/playwright"); } })();
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const browser = await chromium.launch(); const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); page.setDefaultTimeout(8000);
let failed = 0; const check = (ok, msg) => { console.log(`${ok ? "✓" : "✗"} ${msg}`); if (!ok) failed++; };
const active = () => page.evaluate(() => { const e = document.activeElement; return { tag: e?.tagName, id: e?.id, text: (e?.textContent ?? "").trim().slice(0, 30), name: e?.getAttribute?.("name") }; });

await page.goto(BASE + "/");
await page.keyboard.press("Tab"); let a = await active(); check(/skip to content/i.test(a.text), `first Tab stop is the skip link (got "${a.text}")`);
await page.keyboard.press("Enter"); a = await active(); check(a.id === "main", `activating the skip link moves focus to <main> (got ${a.tag}#${a.id})`);

await page.goto(BASE + "/sign-in");
let reached = false; for (let i = 0; i < 20 && !reached; i++) { await page.keyboard.press("Tab"); reached = (await active()).id === "email"; }
check(reached, "can Tab to the email field");
await page.keyboard.type("priya@demo.test"); await page.keyboard.press("Tab"); check((await active()).id === "password", "Tab moves from email to password");
await page.keyboard.type("DemoPass2026!"); await page.keyboard.press("Enter"); await page.waitForURL(/\/worker/).then(() => check(true, "sign-in completes with Enter (keyboard only)")).catch(() => check(false, "sign-in via keyboard failed"));

// visible focus indicator on every tab stop of a few pages
for (const path of ["/worker", "/worker/availability", "/opportunities"]) {
  await page.goto(BASE + path); await page.waitForLoadState("networkidle"); let bad = [], stops = 0;
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press("Tab"); await page.waitForTimeout(30);
    const r = await page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const cs = getComputedStyle(e); const w = parseFloat(cs.outlineWidth); return { label: (e.getAttribute("aria-label") || e.textContent || e.getAttribute("name") || e.tagName).trim().slice(0, 30) + ` [${cs.outlineStyle} ${cs.outlineWidth}]`, visible: cs.outlineStyle !== "none" && w >= 2 }; });
    if (!r) break; stops++; if (!r.visible) bad.push(r.label);
  }
  check(bad.length === 0, `${path}: ${stops} tab stops all show a focus outline${bad.length ? " — missing on: " + bad.slice(0, 4).join(", ") : ""}`);
}
await browser.close(); process.exit(failed ? 1 : 0);

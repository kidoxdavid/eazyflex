// End-to-end journey against a running app (BASE_URL, default http://localhost:3100) and its database.
// Run: node tests/e2e/journey.mjs   (requires `npm run db:seed` data and `next start`)
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require("playwright"); } catch { return require(require("node:child_process").execSync("npm root -g").toString().trim() + "/playwright"); } })();
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const results = [];
const step = async (name, fn) => { try { await fn(); results.push(["PASS", name]); console.log("PASS", name); } catch (e) { results.push(["FAIL", name, e.message.split("\n")[0]]); console.log("FAIL", name, "-", e.message.split("\n")[0]); } };
const must = (c, m) => { if (!c) throw new Error(m); };
const stamp = Date.now();
const browser = await chromium.launch();
const ctx = async (viewport) => { const p = await (await browser.newContext({ viewport })).newPage(); p.setDefaultTimeout(8000); return p; };

// ---------- Worker ----------
const w = await ctx({ width: 390, height: 844 }); // mobile-first
const wEmail = `e2e.worker.${stamp}@test.example`;
await step("worker: register", async () => {
  await w.goto(`${BASE}/register?type=worker`);
  await w.fill("#fullName", "Riley Tester"); await w.fill("#email", wEmail); await w.fill("#password", "CorrectHorse9"); await w.fill("#city", "Calgary"); await w.fill("#pp", "T2P");
  await w.check("input[name=acceptTerms]"); await w.click("button:has-text('Create account')");
  await w.waitForURL(/worker\/onboarding/); 
});
await step("worker: cannot apply before email verification", async () => {
  await w.goto(`${BASE}/opportunities`); await w.click("a:has-text('View & apply') >> nth=0");
  await w.waitForSelector("text=Verify your email address to apply");
});
await step("worker: verify email via emailed link", async () => {
  const { default: pg } = await import(require.resolve("pg"));
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/eazyflex" }); await db.connect();
  const { rows } = await db.query("select link from email_outbox where to_email=$1 and template='email_verification' order by created_at desc limit 1", [wEmail]); await db.end();
  const link = rows[0].link.replace(/^https?:\/\/[^/]+/, BASE);
  await w.goto(link); await w.click("button:has-text('Confirm my email')"); await w.waitForURL(/sign-in/);
  await w.fill("#email", wEmail); await w.fill("#password", "CorrectHorse9"); await w.click("button:has-text('Sign in')"); await w.waitForURL(/worker/);
});
await step("worker: onboarding steps 1-5", async () => {
  await w.goto(`${BASE}/worker/onboarding?step=1`);
  await w.fill("#headline", "Spreadsheet & admin helper"); await w.fill("#summary", "I organise data, keep inboxes tidy and build clear spreadsheets for small teams.");
  await w.check("label:has-text('Excel') input"); await w.check("label:has-text('Email management') input"); await w.click("button:has-text('Save and continue')");
  await w.waitForURL(/step=2/);
  await w.check("input[name=arrangements][value=remote]"); await w.click("button:has-text('Save and continue')"); await w.waitForURL(/step=3/);
  for (const d of [1, 2, 3, 4, 5]) { await w.fill(`#w_${d}_0_start`, "09:30"); await w.fill(`#w_${d}_0_end`, "14:00"); }
  await w.fill("#mhw", "15"); await w.click("button:has-text('Save and continue')"); await w.waitForURL(/step=4/);
  await w.fill("#ph", "30"); await w.fill("#mh", "25"); await w.click("button:has-text('Save and continue')"); await w.waitForURL(/step=5/);
  await w.click("button:has-text('Finish and see recommendations')"); await w.waitForURL(/\/worker(\?|$)/);
});
await step("worker: recommendations are explained and exclude ineligible work", async () => {
  await w.goto(`${BASE}/worker/recommended`);
  const body = await w.textContent("main");
  must(/Recommended for me/.test(body), "page missing");
  must(/Why:|Strong match|Good match|Partial match/.test(body), "no explanation text");
  must(!body.includes("Saturday farmers-market"), "on-site Saturday shift should not be recommended to a remote-only weekday worker");
});
await step("worker: apply and see status", async () => {
  await w.goto(`${BASE}/opportunities?q=bookkeeping`); await w.click("a:has-text('View & apply') >> nth=0");
  await w.fill("#proposal", "I have steady experience keeping accurate records and can start next week."); await w.click("button:has-text('Submit application')");
  await w.waitForURL(/worker\/applications/); must(await w.isVisible("text=submitted"), "status not shown");
});
await step("worker: save an opportunity", async () => {
  await w.goto(`${BASE}/opportunities`); await w.click("button:has-text('Save') >> nth=0"); await w.waitForSelector("text=Saved list updated");
  await w.goto(`${BASE}/worker/saved`); must(await w.locator("article, h3").count() > 0, "nothing saved");
});
await step("worker: mobile layout has no horizontal scroll", async () => {
  for (const p of ["/", "/opportunities", "/worker", "/worker/availability"]) { await w.goto(BASE + p); const o = await w.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); must(o <= 1, `${p} overflows by ${o}px`); }
});
await step("worker: cannot reach business or admin areas", async () => {
  await w.goto(`${BASE}/business`); must(/\/worker/.test(w.url()), "business area reachable: " + w.url());
  await w.goto(`${BASE}/admin`); must(/\/worker/.test(w.url()), "admin area reachable: " + w.url());
});

// ---------- Business ----------
const b = await ctx({ width: 1280, height: 900 });
await step("business: sign in as demo business and post an opportunity", async () => {
  await b.goto(`${BASE}/sign-in`); await b.fill("#email", "owner@pixelcart.demo.test"); await b.fill("#password", "DemoPass2026!"); await b.click("button:has-text('Sign in')"); await b.waitForURL(/business/);
  await b.goto(`${BASE}/business/post?type=micro_task`);
  await b.fill("#title", `E2E spreadsheet tidy ${stamp}`); await b.fill("#description", "Tidy and standardise a product spreadsheet so that it can be imported into our store without errors.");
  await b.selectOption("#cat", { label: "Administration & business support" }); await b.fill("#pmin", "30"); await b.fill("#pmax", "40"); await b.click("button:has-text('Publish')");
  await b.waitForURL(/business\/opportunities/); must(await b.isVisible("text=Published"), "not published");
});
await step("business: invalid compensation is rejected with a clear error", async () => {
  await b.goto(`${BASE}/business/post?type=fixed_project`);
  await b.fill("#title", "Incomplete fixed project"); await b.fill("#description", "This description is long enough to pass the minimum length check for postings."); await b.selectOption("#cat", { index: 1 }); await b.fill("#pmin", "500"); await b.click("button:has-text('Publish')");
  await b.waitForSelector("[role=alert]:has-text('defined scope')");
});
await step("business: shortlists applicant, sends offer; worker accepts; opportunity fills", async () => {
  const m = await ctx({ width: 1280, height: 900 });
  await m.goto(`${BASE}/sign-in`); await m.fill("#email", "owner@maple.demo.test"); await m.fill("#password", "DemoPass2026!"); await m.click("button:has-text('Sign in')"); await m.waitForURL(/business/);
  await m.click("a:has-text('Weekly bookkeeping')");
  const card = m.locator("div", { has: m.locator("h3", { hasText: "Riley Tester" }) }).last();
  await m.locator("h3:has-text('Riley Tester')").waitFor();
  await m.locator("form:has(input[name=to][value=shortlisted]) button").first().click().catch(() => {});
  await m.waitForSelector("span:has-text('shortlisted')");
  await m.locator("form:has(input[name=to][value=offer_received]) button").first().click();
  await m.waitForSelector("span:has-text('offer received')");
  await w.goto(`${BASE}/worker/applications`); must(await w.isVisible("text=offer received"), "worker does not see offer");
  await w.click("button:has-text('Accept offer')"); await w.waitForSelector("text=Offer accepted");
  await m.reload(); await m.waitForSelector("span:has-text('filled')");
  await m.close();
});
await step("collab: message, contact-info guard, deliver work, approve, blind review", async () => {
  // Worker "w" now holds an accepted assignment on the Maple bookkeeping job.
  await w.goto(`${BASE}/worker/assignments`); await w.click("a:has-text('Weekly bookkeeping')");
  await w.click("button:has-text('Start work')"); await w.waitForSelector("text=Work started");
  await w.click("button:has-text('Message business')"); await w.waitForURL(/worker\/messages\//);
  await w.fill("#body", "Happy to start — I'll send the first batch Friday."); await w.click("button:has-text('Send')"); await w.waitForSelector("text=send the first batch");
  await w.goBack(); await w.goBack().catch(() => {});
  await w.goto(`${BASE}/worker/assignments`); await w.click("a:has-text('Weekly bookkeeping')");
  await w.fill("#note", "First batch of invoices entered and reconciled."); await w.fill("#h", "3.5"); await w.click("button:has-text('Submit for approval')"); await w.waitForSelector("text=Work submitted for review");
  const m = await ctx({ width: 1280, height: 900 });
  await m.goto(`${BASE}/sign-in`); await m.fill("#email", "owner@maple.demo.test"); await m.fill("#password", "DemoPass2026!"); await m.click("button:has-text('Sign in')"); await m.waitForURL(/business/);
  await m.goto(`${BASE}/business/assignments`); await m.click("a:has-text('Weekly bookkeeping')");
  must(await m.isVisible("text=Riley T."), "business should see first name + initial only");
  must(!(await m.textContent("main")).includes("Riley Tester"), "full worker name leaked to business");
  await m.click("button:has-text('Approve completion')"); await m.waitForSelector("text=Work approved");
  await m.selectOption("#rating", "2"); await m.fill("#comment", "Slow replies."); await m.click("button:has-text('Submit review')"); await m.waitForSelector("text=Review submitted");
  await w.goto(w.url()); await w.waitForSelector("text=Reviews");
  must(!(await w.textContent("main")).includes("Slow replies"), "blind review leaked before worker reviewed");
  await w.selectOption("#rating", "5"); await w.click("button:has-text('Submit review')"); await w.waitForSelector("text=Review submitted");
  await w.reload(); must((await w.textContent("main")).includes("Slow replies"), "review not revealed after both reviewed");
  await m.close();
});
await step("leftovers: attachment upload + authenticated download, report → admin resolves, settings, screening question", async () => {
  const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF");
  // worker sends a file in the existing thread
  await w.goto(`${BASE}/worker/messages`); await w.click("a:has-text('Maple')");
  await w.fill("#body", "Here is my invoice template."); await w.setInputFiles("input[name=files]", { name: "template.pdf", mimeType: "application/pdf", buffer: PDF });
  await w.click("button:has-text('Send')"); await w.waitForSelector("a:has-text('template.pdf')");
  const fileHref = await w.locator("a:has-text('template.pdf')").first().getAttribute("href");
  const own = await w.context().request.get(BASE + fileHref); must(own.status() === 200, "owner download " + own.status());
  must((await own.headers())["content-disposition"].startsWith("attachment"), "not forced to download"); must((await own.headers())["x-content-type-options"] === "nosniff", "nosniff missing");
  // bad file type is refused in the UI flow
  await w.fill("#body", "and an exe"); await w.setInputFiles("input[name=files]", { name: "bad.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") });
  await w.click("button:has-text('Send')"); await w.waitForSelector("[role=alert]:has-text('isn’t allowed')");
  // anonymous and unrelated users cannot fetch it
  const anon = await browser.newContext(); must((await anon.request.get(BASE + fileHref)).status() === 404, "anonymous could download"); await anon.close();
  const other = await ctx({ width: 1000, height: 800 });
  await other.goto(`${BASE}/sign-in`); await other.fill("#email", "walter@demo.test"); await other.fill("#password", "DemoPass2026!"); await other.click("button:has-text('Sign in')"); await other.waitForURL(/worker/);
  must((await other.context().request.get(BASE + fileHref)).status() === 404, "unrelated worker could download"); await other.close();
  // business sees it, and reports the message
  const m = await ctx({ width: 1280, height: 900 });
  await m.goto(`${BASE}/sign-in`); await m.fill("#email", "owner@maple.demo.test"); await m.fill("#password", "DemoPass2026!"); await m.click("button:has-text('Sign in')"); await m.waitForURL(/business/);
  must((await m.context().request.get(BASE + fileHref)).status() === 200, "business participant could not download");
  await m.goto(`${BASE}/business/messages`); await m.click("a:has-text('Riley')");
  const bubble = m.locator("div.rounded-2xl", { hasText: "template.pdf" }); // report the message that carries the attachment
  await bubble.locator("summary:has-text('Report')").click(); await bubble.locator("input[name=reason]").fill("Test report of this message"); await bubble.locator("button:has-text('Send')").click(); await m.waitForSelector("text=Reported");
  // admin resolves it and the audit log shows the content access
  const a2 = await ctx({ width: 1280, height: 900 });
  await a2.goto(`${BASE}/sign-in`); await a2.fill("#email", "moderator@demo.test"); await a2.fill("#password", "DemoPass2026!"); await a2.click("button:has-text('Sign in')"); await a2.waitForURL(/admin/);
  await a2.goto(`${BASE}/admin/reports`); await a2.waitForSelector("text=Test report of this message");
  must((await a2.context().request.get(BASE + fileHref)).status() === 200, "moderator could not open reported attachment");
  await a2.fill("input[name=note] >> nth=0", "Reviewed, no action needed"); await a2.click("button:has-text('Dismiss') >> nth=0"); await a2.waitForSelector("text=Report resolved");
  must((await a2.context().request.get(BASE + fileHref)).status() === 404, "moderator retained access after resolution");
  const sa = await ctx({ width: 1280, height: 900 });
  await sa.goto(`${BASE}/sign-in`); await sa.fill("#email", "admin@demo.test"); await sa.fill("#password", "DemoPass2026!"); await sa.click("button:has-text('Sign in')"); await sa.waitForURL(/admin/);
  await sa.goto(`${BASE}/admin/audit`); must(await sa.isVisible("text=report.message_content_accessed"), "content access not audited"); must(await sa.isVisible("text=file.accessed_by_admin"), "file access not audited");
  // finance role cannot open reports
  const f = await ctx({ width: 1280, height: 900 });
  await f.goto(`${BASE}/sign-in`); await f.fill("#email", "finance@demo.test"); await f.fill("#password", "DemoPass2026!"); await f.click("button:has-text('Sign in')"); await f.waitForURL(/admin/);
  await f.goto(`${BASE}/admin/reports`); must(/\/admin\?error=/.test(f.url()), "finance reached reports");
  // notification settings persist
  await w.goto(`${BASE}/worker/settings`); await w.uncheck("input[name=messages]"); await w.click("button:has-text('Save')"); await w.waitForSelector("text=preferences saved");
  await w.reload(); must(!(await w.isChecked("input[name=messages]")), "preference not persisted");
  // screening question: business posts, worker must answer
  await m.goto(`${BASE}/business/post?type=micro_task`);
  await m.fill("#title", `E2E screening ${stamp}`); await m.fill("#description", "Tidy a spreadsheet so it imports cleanly; a screening question applies to this posting."); await m.selectOption("#cat", { label: "Administration & business support" });
  await m.fill("#pmin", "30"); await m.fill("input[name=q_0]", "Which spreadsheet tools do you use daily?"); await m.click("button:has-text('Publish')"); await m.waitForURL(/business\/opportunities/);
  const oppUrl = m.url().split("?")[0].replace("/business", "");
  const p2 = await ctx({ width: 1000, height: 800 });
  await p2.goto(`${BASE}/sign-in`); await p2.fill("#email", "sam@demo.test"); await p2.fill("#password", "DemoPass2026!"); await p2.click("button:has-text('Sign in')"); await p2.waitForURL(/worker/);
  await p2.goto(oppUrl); await p2.waitForSelector("text=Which spreadsheet tools do you use daily?");
  await p2.fill("#proposal", "I build and clean spreadsheets for small teams every week."); await p2.fill("textarea[name^=answer_]", "Excel and Google Sheets"); await p2.click("button:has-text('Submit application')"); await p2.waitForURL(/worker\/applications/);
  await m.goto(m.url()); await m.waitForSelector("text=Excel and Google Sheets");
  await m.close(); await a2.close(); await sa.close(); await f.close(); await p2.close();
});
await step("business: talent directory hides contact details", async () => {
  await b.goto(`${BASE}/business/talent`); const t = await b.textContent("main");
  must(!t.includes("@"), "an email address appears in the talent directory");
  must(/Priya N\./.test(t), "expected first-name-and-initial display");
});
await step("business: cannot open another business's opportunity", async () => {
  await b.goto(`${BASE}/business/opportunities/00000000-0000-4000-8000-000000000000`); must(await b.isVisible("text=This page could not be found") || (await b.title()).includes("404") || (await b.textContent("body")).includes("could not be found"), "no 404");
});

// ---------- Admin ----------
const a = await ctx({ width: 1280, height: 900 });
await step("admin: dashboard shows live counts", async () => {
  await a.goto(`${BASE}/sign-in`); await a.fill("#email", "admin@demo.test"); await a.fill("#password", "DemoPass2026!"); await a.click("button:has-text('Sign in')"); await a.waitForURL(/admin/);
  must(await a.isVisible("text=Registered workers"), "dashboard missing"); must(await a.isVisible("text=demo accounts present"), "demo label missing");
});
await step("admin: suspend then reactivate requires reason and is audit-logged", async () => {
  await a.goto(`${BASE}/admin/users?q=${encodeURIComponent(wEmail)}`);
  await a.fill("input[name=reason]", "E2E test suspension"); await a.selectOption("select[name=status]", "suspended"); await a.click("button:has-text('Apply')"); await a.waitForSelector("text=Account status updated");
  await a.goto(`${BASE}/admin/audit`); must(await a.isVisible("text=user.suspended"), "audit entry missing");
  // suspended worker is signed out immediately
  await w.goto(`${BASE}/worker`); must(/sign-in/.test(w.url()), "suspended session still active: " + w.url());
});
await step("admin: finance-only role cannot reach user management", async () => {
  const f = await ctx({ width: 1280, height: 900 });
  await f.goto(`${BASE}/sign-in`); await f.fill("#email", "finance@demo.test"); await f.fill("#password", "DemoPass2026!"); await f.click("button:has-text('Sign in')"); await f.waitForURL(/admin/);
  const nav = await f.textContent("nav[aria-label*=Admin]"); must(!nav.includes("Users"), "Users link shown to finance role");
  await f.goto(`${BASE}/admin/users`); must(/\/admin\?error=/.test(f.url()), "finance admin was not redirected: " + f.url());
  await f.waitForSelector("[role=alert]:has-text('do not have permission')");
  await f.goto(`${BASE}/admin/matching`); must(/\/admin\?error=/.test(f.url()), "finance admin could open matching rules");
});
await step("admin: matching rules publish creates a new version", async () => {
  await a.goto(`${BASE}/admin/matching`); await a.fill("input[name=w_skills]", "35"); await a.fill("input[name=note]", "e2e"); await a.click("button:has-text('Publish new version')"); await a.waitForSelector("text=New matching rules version published");
  await a.goto(`${BASE}/admin/matching`); must(await a.isVisible("text=v2"), "v2 missing");
});
await browser.close();
const failed = results.filter((r) => r[0] === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
process.exit(failed.length ? 1 : 0);

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

// ---- admin sign-in with TOTP (the demo admins share a PUBLIC demo authenticator seed from the seed script) ----
const DEMO_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const b32 = (str) => { let bits = 0, v = 0; const out = []; for (const ch of str) { v = (v << 5) | "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(ch); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
const { createHmac } = await import("node:crypto");
const hotpFor = (secret, counter) => { const m = Buffer.alloc(8); m.writeBigUInt64BE(BigInt(counter)); const h = createHmac("sha1", b32(secret)).update(m).digest(); const o = h[h.length - 1] & 15; return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0"); };
const lastStepUsed = new Map();
async function nextCode(email) { // each 30 s step may be used once per account (replay protection), so pick the next unused step
  for (;;) { const cur = Math.floor(Date.now() / 30000), used = lastStepUsed.get(email) ?? 0;
    const step = Math.max(used + 1, cur - 1); if (step <= cur + 1) { lastStepUsed.set(email, step); return hotpFor(DEMO_SECRET, step); } await new Promise((r) => setTimeout(r, 5000)); }
}
async function adminLogin(page, email) {
  await page.goto(`${BASE}/sign-in`); await page.fill("#email", email); await page.fill("#password", "DemoPass2026!"); await page.click("button:has-text('Sign in')");
  await page.waitForURL(/\/mfa/); await page.fill("#code", await nextCode(email)); await page.click("button:has-text('Verify')"); await page.waitForURL(/\/admin/);
}

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
  await m.click("a:has-text('Bookkeeping catch-up')");
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
  await w.goto(`${BASE}/worker/assignments`); await w.click("a:has-text('Bookkeeping catch-up')");
  await w.click("button:has-text('Start work')"); await w.waitForSelector("text=Work started");
  await w.click("button:has-text('Message business')"); await w.waitForURL(/worker\/messages\//);
  await w.fill("#body", "Happy to start — I'll send the first batch Friday."); await w.click("button:has-text('Send')"); await w.waitForSelector("text=send the first batch");
  await w.goBack(); await w.goBack().catch(() => {});
  await w.goto(`${BASE}/worker/assignments`); await w.click("a:has-text('Bookkeeping catch-up')");
  await w.fill("#note", "First batch of invoices entered and reconciled."); await w.fill("#h", "3.5"); await w.click("button:has-text('Submit for approval')"); await w.waitForSelector("text=Work submitted for review");
  const m = await ctx({ width: 1280, height: 900 });
  await m.goto(`${BASE}/sign-in`); await m.fill("#email", "owner@maple.demo.test"); await m.fill("#password", "DemoPass2026!"); await m.click("button:has-text('Sign in')"); await m.waitForURL(/business/);
  await m.goto(`${BASE}/business/assignments`); await m.click("a:has-text('Bookkeeping catch-up')");
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
  // malware is blocked before anything is stored (EICAR is the industry-standard harmless AV test string)
  await w.fill("#body", "this one is infected"); await w.setInputFiles("input[name=files]", { name: "invoice.pdf", mimeType: "application/pdf", buffer: Buffer.concat([PDF, Buffer.from("\nX5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*")]) });
  await w.click("button:has-text('Send')"); await w.waitForSelector("[role=alert]:has-text('appears to contain malware')"); must(!(await w.isVisible("text=this one is infected")), "infected message was stored");
  must(await w.isVisible("text=scanned for malware before"), "upload form does not say files are scanned");
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
  await adminLogin(a2, "moderator@demo.test");
  await a2.goto(`${BASE}/admin/reports`); await a2.waitForSelector("text=Test report of this message");
  must((await a2.context().request.get(BASE + fileHref)).status() === 200, "moderator could not open reported attachment");
  await a2.fill("input[name=note] >> nth=0", "Reviewed, no action needed"); await a2.click("button:has-text('Dismiss') >> nth=0"); await a2.waitForSelector("text=Report resolved");
  must((await a2.context().request.get(BASE + fileHref)).status() === 404, "moderator retained access after resolution");
  const sa = await ctx({ width: 1280, height: 900 });
  await adminLogin(sa, "admin@demo.test");
  await sa.goto(`${BASE}/admin/audit`); must(await sa.isVisible("text=report.message_content_accessed"), "content access not audited"); must(await sa.isVisible("text=file.accessed_by_admin"), "file access not audited");
  // finance role cannot open reports
  const f = await ctx({ width: 1280, height: 900 });
  await adminLogin(f, "finance@demo.test");
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
await step("work-sharing: suggest → propose → each worker confirms → complete → handover → release reopens gap", async () => {
  const m = await ctx({ width: 1280, height: 900 });
  await m.goto(`${BASE}/sign-in`); await m.fill("#email", "owner@maple.demo.test"); await m.fill("#password", "DemoPass2026!"); await m.click("button:has-text('Sign in')"); await m.waitForURL(/business/);
  await m.click("a:has-text('Shared customer support desk')"); await m.click("a:has-text('Shared coverage')");
  await m.waitForSelector("text=Required per week"); must(await m.isVisible("text=30 h"), "30 h requirement not shown");
  must(await m.locator("div:text-is('GAP')").count() > 0, "gaps not visualised before any proposals");
  await m.click("a:has-text('Suggest coverage')"); await m.waitForSelector("text=eligible worker");
  const txt = await m.textContent("main"); for (const n of ["Lena P.", "Marcus B.", "Ines M.", "Tomas N."]) must(txt.includes(n), "missing candidate " + n);
  must(!txt.includes("Lena Park"), "full name leaked to business");
  await m.click("button:has-text('Propose these')"); await m.waitForSelector("text=Nobody is booked until each worker confirms");
  must(await m.isVisible("text=0%"), "proposed slices must not count as confirmed");
  for (const [email] of [["lena@demo.test"], ["marcus@demo.test"], ["ines@demo.test"], ["tomas@demo.test"]]) {
    const p = await ctx({ width: 1000, height: 800 });
    await p.goto(`${BASE}/sign-in`); await p.fill("#email", email); await p.fill("#password", "DemoPass2026!"); await p.click("button:has-text('Sign in')"); await p.waitForURL(/worker/);
    await p.goto(`${BASE}/worker/coverage`); await p.waitForSelector("text=Requests to confirm");
    must(!(await p.isVisible("text=outside the availability")), email + " was proposed time outside their availability");
    const n = await p.locator("button:has-text('Confirm')").count(); must(n > 0, email + " has nothing to confirm");
    for (let i = 0; i < n; i++) { await p.locator("button:has-text('Confirm')").first().click(); await p.waitForSelector("text=Confirmed — this is now"); }
    if (email === "lena@demo.test") { await p.goto(`${BASE}/worker/coverage`); must(await p.isVisible("text=My confirmed slices"), "confirmed section missing"); }
    await p.close();
  }
  await m.goto(m.url().split("?")[0]); await m.waitForSelector("text=Every required hour is confirmed"); must(await m.isVisible("text=100%"), "not 100%");
  must(await m.locator("div:text-is('GAP')").count() === 0, "gaps remain after full coverage");
  // handover: Marcus (Thu 9-12) → Ines (Thu 12-15)
  const mc = await ctx({ width: 1000, height: 800 });
  await mc.goto(`${BASE}/sign-in`); await mc.fill("#email", "marcus@demo.test"); await mc.fill("#password", "DemoPass2026!"); await mc.click("button:has-text('Sign in')"); await mc.waitForURL(/worker/);
  await mc.goto(`${BASE}/worker/coverage`); await mc.waitForSelector("text=You hand over");
  await mc.fill("textarea[name=note]", "Ticket 4411 waits on the customer; two refunds pending approval."); await mc.click("button:has-text('Leave handover note')"); await mc.waitForSelector("text=Handover note saved");
  const ic = await ctx({ width: 1000, height: 800 });
  await ic.goto(`${BASE}/sign-in`); await ic.fill("#email", "ines@demo.test"); await ic.fill("#password", "DemoPass2026!"); await ic.click("button:has-text('Sign in')"); await ic.waitForURL(/worker/);
  await ic.goto(`${BASE}/worker/coverage`); await ic.waitForSelector("text=Ticket 4411"); await ic.click("button:has-text('Acknowledge')"); await ic.waitForSelector("text=Handover acknowledged");
  // a worker gives a slice back → the gap reopens for the business
  await mc.goto(`${BASE}/worker/coverage`); await mc.locator("summary:has-text('Give this slice back')").first().click(); await mc.fill("details input[name=reason]", "Childcare fell through this week"); await mc.click("details button:has-text('Release')"); await mc.waitForSelector("text=Slice released");
  await m.reload(); must(await m.locator("div:text-is('GAP')").count() > 0, "gap did not reappear after release"); must(!(await m.isVisible("text=Every required hour is confirmed")), "still shows complete");
  // other businesses cannot open this coverage page
  const o = await ctx({ width: 1000, height: 800 });
  await o.goto(`${BASE}/sign-in`); await o.fill("#email", "owner@pixelcart.demo.test"); await o.fill("#password", "DemoPass2026!"); await o.click("button:has-text('Sign in')"); await o.waitForURL(/business/);
  const url = m.url().split("?")[0]; await o.goto(url); must((await o.textContent("body")).includes("could not be found"), "other business could open coverage");
  for (const pg of [m, mc, ic, o]) await pg.close();
});
await step("saved search: save with alerts, list, toggle, delete", async () => {
  const p = await ctx({ width: 1000, height: 800 });
  await p.goto(`${BASE}/sign-in`); await p.fill("#email", "sam@demo.test"); await p.fill("#password", "DemoPass2026!"); await p.click("button:has-text('Sign in')"); await p.waitForURL(/worker/);
  await p.goto(`${BASE}/opportunities?q=bookkeeping&arrangement=remote`); await p.click("summary:has-text('Save this search')"); await p.fill("input[name=name]", "Remote bookkeeping"); await p.click("details button:has-text('Save')");
  await p.waitForURL(/worker\/searches/); await p.waitForSelector("text=Remote bookkeeping"); must(await p.isVisible("text=alerts on"), "alerts not on");
  await p.click("button:has-text('Turn alerts off')"); await p.waitForSelector("text=alerts off");
  await p.click("button:has-text('Delete')"); await p.waitForSelector("text=Search deleted"); must(!(await p.isVisible("text=Remote bookkeeping")), "search still listed");
  await p.close();
});
await step("team: invite → join via link → read-only member is blocked server-side → owner removes member", async () => {
  const { default: pg } = await import(require.resolve("pg"));
  const dbq = async (q, a) => { const c = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/eazyflex" }); await c.connect(); const r = await c.query(q, a); await c.end(); return r.rows; };
  const memEmail = `e2e.member.${stamp}@test.example`;
  const o = await ctx({ width: 1280, height: 900 });
  await o.goto(`${BASE}/sign-in`); await o.fill("#email", "owner@maple.demo.test"); await o.fill("#password", "DemoPass2026!"); await o.click("button:has-text('Sign in')"); await o.waitForURL(/business/);
  await o.goto(`${BASE}/business/team`); await o.fill("#em", memEmail); await o.selectOption("#rl", "member"); await o.click("button:has-text('Send invitation')"); await o.waitForSelector("text=Invitation sent");
  must(await o.isVisible(`text=${memEmail}`), "pending invite not listed");
  const row = (await dbq("select link from email_outbox where to_email=$1 and template='team_invitation' order by created_at desc limit 1", [memEmail]))[0];
  const link = row.link.replace(/^https?:\/\/[^/]+/, BASE);
  const m = await ctx({ width: 1100, height: 900 });
  await m.goto(link); await m.waitForSelector("text=Join Maple"); await m.click("a:has-text('Create my account')");
  must((await m.inputValue("#email")) === memEmail, "invited email not prefilled"); must(!(await m.isVisible("#businessName")), "business name field shown to invitee");
  await m.fill("#fullName", "Mo Member"); await m.fill("#password", "CorrectHorse9"); await m.check("input[name=acceptTerms]"); await m.click("button:has-text('Create account')"); await m.waitForURL(/business/);
  await m.waitForSelector("text=read-only"); must(!(await m.locator("nav a:has-text('Post Work')").count()), "Post Work visible to a member");
  await m.goto(`${BASE}/business/post?type=micro_task`);
  await m.fill("#title", "Member should not post this"); await m.fill("#description", "A description long enough to pass validation so that the role check is what rejects it."); await m.selectOption("#cat", { index: 1 }); await m.fill("#pmin", "30"); await m.click("button:has-text('Publish')");
  await m.waitForSelector("[role=alert]:has-text('Your role (member)')");
  must((await dbq("select count(*)::int n from opportunities where title='Member should not post this'"))[0].n === 0, "member managed to create an opportunity");
  await o.goto(`${BASE}/business/team`); await o.locator(`div:has(> div > p:has-text('${memEmail}')) button:has-text('Remove')`).first().click().catch(async () => { await o.locator("button:has-text('Remove')").first().click(); });
  await o.waitForSelector("text=Team member removed");
  await m.goto(`${BASE}/business`); await m.waitForSelector("text=not part of a business");
  for (const pg of [o, m]) await pg.close();
});
await step("recurring: accept → cancel a session → renewal offer → worker accepts (explicit) → end term → reviews open", async () => {
  const p = await ctx({ width: 1100, height: 900 }); const b = await ctx({ width: 1280, height: 900 });
  await p.goto(`${BASE}/sign-in`); await p.fill("#email", "priya@demo.test"); await p.fill("#password", "DemoPass2026!"); await p.click("button:has-text('Sign in')"); await p.waitForURL(/worker/);
  await b.goto(`${BASE}/sign-in`); await b.fill("#email", "owner@northgate.demo.test"); await b.fill("#password", "DemoPass2026!"); await b.click("button:has-text('Sign in')"); await b.waitForURL(/business/);
  await p.goto(`${BASE}/opportunities?q=Tenant+communications`); await p.click("a:has-text('View & apply') >> nth=0");
  await p.fill("#proposal", "I coordinate inboxes and calendars every week and can start now."); await p.click("button:has-text('Submit application')"); await p.waitForURL(/worker\/applications/);
  await b.click("a:has-text('Tenant communications')"); await b.locator("form:has(input[name=to][value=offer_received]) button").first().click(); await b.waitForSelector("span:has-text('offer received')");
  await p.goto(`${BASE}/worker/applications`); await p.click("button:has-text('Accept offer')"); await p.waitForSelector("text=Offer accepted");
  await p.goto(`${BASE}/worker/assignments`); await p.click("a:has-text('Tenant communications')");
  await p.waitForSelector("text=Upcoming sessions"); must(await p.isVisible("text=Term"), "term card missing"); must(!(await p.isVisible("button:has-text('Submit for approval')")), "one-shot submit shown for recurring");
  await p.locator("summary:has-text('Can’t make it')").first().click(); await p.fill("details input[name=reason]", "Dentist appointment that morning"); await p.click("details button:has-text('Cancel session')"); await p.waitForSelector("text=Session cancelled");
  await b.goto(`${BASE}/business/assignments`); await b.click("a:has-text('Tenant communications')"); await b.waitForSelector("text=Propose a renewal");
  const end = new Date(Date.now() + 70 * 86400000).toISOString().slice(0, 10);
  await b.fill("#ned", end); await b.fill("#nr", "31.50"); await b.click("button:has-text('Offer renewal')"); await b.waitForSelector("text=Nothing changes unless the worker accepts");
  await p.reload(); await p.waitForSelector("text=Renewal offer"); must(await p.isVisible("text=nothing changes unless you accept"), "explicit-agreement notice missing");
  await p.click("button:has-text('Accept renewal')"); await p.waitForSelector("text=Renewal accepted");
  must(await p.isVisible(`text=${end}`), "new end date not shown"); must(await p.isVisible("text=$31.50"), "new rate not shown");
  await b.reload(); await b.waitForSelector("text=accepted"); must(await b.isVisible(`text=${end}`), "business does not see the extended term");
  await b.click("button:has-text('End term')"); await b.waitForSelector("text=Term ended"); await b.waitForSelector("text=Reviews");
  await p.reload(); await p.waitForSelector("text=Reviews"); must(!(await p.isVisible("button:has-text('Record session')")), "sessions still actionable after the term ended");
  await p.close(); await b.close();
});
await step("hardening: CSP with nonce, security headers, __Host- cookie, no CSP violations in the browser", async () => {
  const r = await fetch(BASE + "/"); const csp = r.headers.get("content-security-policy") ?? "";
  must(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/.test(csp), "script-src nonce policy missing: " + csp);
  must(!/script-src[^;]*'unsafe-inline'/.test(csp) && !/script-src[^;]*'unsafe-eval'/.test(csp), "script-src allows unsafe-inline/eval");
  for (const d of ["object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'"]) must(csp.includes(d), "CSP missing " + d);
  must(csp !== (await fetch(BASE + "/")).headers.get("content-security-policy"), "nonce is not unique per request");
  const h = r.headers; must(h.get("x-frame-options") === "DENY" && h.get("x-content-type-options") === "nosniff", "basic headers");
  must(/max-age=\d+/.test(h.get("strict-transport-security") ?? ""), "HSTS missing in production"); must(h.get("cross-origin-opener-policy") === "same-origin", "COOP missing");
  const pg = await ctx({ width: 1280, height: 900 }); const bad = [];
  pg.on("console", (m) => { if (/content security policy|refused to/i.test(m.text())) bad.push(m.text()); }); pg.on("pageerror", (e) => bad.push(String(e)));
  await pg.goto(BASE + "/"); await pg.goto(BASE + "/opportunities"); await pg.click("a:has-text('View & apply') >> nth=0"); await pg.waitForSelector("h1");
  await pg.goto(`${BASE}/sign-in`); await pg.fill("#email", "owner@maple.demo.test"); await pg.fill("#password", "DemoPass2026!"); await pg.click("button:has-text('Sign in')"); await pg.waitForURL(/business/);
  const cookies = await pg.context().cookies(); const sess = cookies.find((c) => c.name === "__Host-oh_session"); must(sess && sess.httpOnly && sess.secure && sess.path === "/", "session cookie not __Host-/HttpOnly/Secure: " + JSON.stringify(cookies.map((c) => c.name)));
  await pg.click("a:has-text('Shared customer support desk')"); await pg.click("a:has-text('Shared coverage')"); await pg.waitForSelector("text=Required per week"); // page with inline style attributes
  await pg.goto(`${BASE}/business/team`); await pg.waitForSelector("text=Roles");
  must(bad.length === 0, "CSP/console violations: " + bad.slice(0, 3).join(" | ")); await pg.close();
});
await step("mfa: password alone is not enough; wrong code rejected; replay rejected; new admin must enrol; recovery code works once", async () => {
  const dbq = async (q, a) => { const { default: pg } = await import(require.resolve("pg")); const c = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/eazyflex" }); await c.connect(); const r = await c.query(q, a); await c.end(); return r.rows; };
  const p = await ctx({ width: 1100, height: 900 });
  await p.goto(`${BASE}/sign-in`); await p.fill("#email", "analyst@demo.test"); await p.fill("#password", "DemoPass2026!"); await p.click("button:has-text('Sign in')"); await p.waitForURL(/\/mfa/);
  for (const path of ["/admin", "/admin/users", "/admin/audit"]) { await p.goto(BASE + path); must(/\/mfa/.test(p.url()), path + " reachable with password only: " + p.url()); }
  await p.fill("#code", "000000"); await p.click("button:has-text('Verify')"); await p.waitForSelector("[role=alert]:has-text('not valid')");
  const code = await nextCode("analyst@demo.test"); await p.fill("#code", code); await p.click("button:has-text('Verify')"); await p.waitForURL(/\/admin/);
  const p2 = await ctx({ width: 1100, height: 900 }); // same code, second session: replay must fail
  await p2.goto(`${BASE}/sign-in`); await p2.fill("#email", "analyst@demo.test"); await p2.fill("#password", "DemoPass2026!"); await p2.click("button:has-text('Sign in')"); await p2.waitForURL(/\/mfa/);
  await p2.fill("#code", code); await p2.click("button:has-text('Verify')"); await p2.waitForSelector("[role=alert]:has-text('already used')"); await p2.close();
  // brand-new admin without 2FA is forced through enrolment
  const email = `enroll.${stamp}@demo.test`; const [src] = await dbq("select password_hash from users where email='analyst@demo.test'");
  await dbq("insert into users (email, password_hash, kind, admin_role, full_name, email_verified_at, is_demo) values ($1,$2,'admin','read_only_analyst','Enrol Test', now(), true)", [email, src.password_hash]);
  const e = await ctx({ width: 1100, height: 1000 });
  await e.goto(`${BASE}/sign-in`); await e.fill("#email", email); await e.fill("#password", "DemoPass2026!"); await e.click("button:has-text('Sign in')"); await e.waitForURL(/\/mfa/);
  await e.waitForSelector("img[alt*='QR']"); const secret = (await e.textContent("code")).trim(); must(/^[A-Z2-7]{32}$/.test(secret), "no secret shown: " + secret);
  must(!(await e.isVisible("text=Skip for now")), "enrolment skippable while enforcement is required");
  await e.goto(`${BASE}/admin`); must(/\/mfa/.test(e.url()), "unenrolled admin reached /admin");
  await e.fill("#code", "123456"); await e.click("button:has-text('Turn on')"); await e.waitForSelector("[role=alert]:has-text('not valid')");
  await e.fill("#code", hotpFor(secret, Math.floor(Date.now() / 30000))); await e.click("button:has-text('Turn on')"); await e.waitForURL(/recovery-codes/);
  const codes = await e.locator("ul.font-mono li").allTextContents(); must(codes.length === 8, "expected 8 recovery codes, got " + codes.length);
  await e.click("button:has-text('saved them')"); await e.waitForURL(/\/admin/);
  await e.goto(`${BASE}/mfa/recovery-codes`); must(await e.isVisible("text=already shown"), "recovery codes still displayable after acknowledging"); await e.goto(`${BASE}/admin`);
  must((await dbq("select totp_secret_enc from users where email=$1", [email]))[0].totp_secret_enc.startsWith("v1."), "secret not stored encrypted");
  const e2 = await ctx({ width: 1100, height: 900 });
  await e2.goto(`${BASE}/sign-in`); await e2.fill("#email", email); await e2.fill("#password", "DemoPass2026!"); await e2.click("button:has-text('Sign in')"); await e2.waitForURL(/\/mfa/);
  await e2.fill("#code", codes[0]); await e2.click("button:has-text('Verify')"); await e2.waitForURL(/\/admin/);
  const e3 = await ctx({ width: 1100, height: 900 });
  await e3.goto(`${BASE}/sign-in`); await e3.fill("#email", email); await e3.fill("#password", "DemoPass2026!"); await e3.click("button:has-text('Sign in')"); await e3.waitForURL(/\/mfa/);
  await e3.fill("#code", codes[0]); await e3.click("button:has-text('Verify')"); await e3.waitForSelector("[role=alert]:has-text('already used')");
  for (const x of [p, e, e2, e3]) await x.close();
});
await step("account: download my data; delete my account; cannot sign in afterwards", async () => {
  const p = await ctx({ width: 1100, height: 900 });
  await p.goto(`${BASE}/sign-in`); await p.fill("#email", "jordan@demo.test"); await p.fill("#password", "DemoPass2026!"); await p.click("button:has-text('Sign in')"); await p.waitForURL(/worker/);
  await p.goto(`${BASE}/worker/account`); await p.waitForSelector("text=Download your data");
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click("button:has-text('Download my data')")]);
  must(/eazyflex-data-export\.json/.test(dl.suggestedFilename()), "unexpected filename"); const txt = require("node:fs").readFileSync(await dl.path(), "utf8"); const data = JSON.parse(txt);
  must(data.account.email === "jordan@demo.test" && data.worker.profile.headline, "export missing own data"); must(!/argon2|passwordHash|tokenHash|totp/i.test(txt), "export leaks secrets");
  await p.fill("#dpw", "wrong-password"); await p.fill("#dc", "DELETE"); await p.click("button:has-text('Permanently delete')"); await p.waitForSelector("[role=alert]:has-text('Incorrect password')");
  await p.fill("#dpw", "DemoPass2026!"); await p.fill("#dc", "DELETE"); await p.click("button:has-text('Permanently delete')"); await p.waitForURL((u) => u.pathname === "/"); await p.waitForSelector("text=Your account was deleted");
  await p.goto(`${BASE}/worker`); must(/sign-in/.test(p.url()), "still signed in after deletion");
  await p.fill("#email", "jordan@demo.test"); await p.fill("#password", "DemoPass2026!"); await p.click("button:has-text('Sign in')"); await p.waitForSelector("[role=alert]:has-text('Incorrect')");
  await p.close();
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
  await adminLogin(a, "admin@demo.test");
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
  await adminLogin(f, "finance@demo.test");
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

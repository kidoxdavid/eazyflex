import "./env";
import { eq, inArray } from "drizzle-orm";
import { db, getPool } from "../src/server/db/client";
import * as s from "../src/server/db/schema";
import { seedReference } from "../src/server/db/seed-data";
import { hashPassword } from "../src/server/auth/password";

if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed demo data in production");
export const DEMO_PASSWORD = "DemoPass2026!";

async function main() {
  await seedReference();
  const pw = await hashPassword(DEMO_PASSWORD);
  const area = Object.fromEntries((await db.select().from(s.serviceAreas)).map((a) => [a.slug, a.id]));
  const cat = Object.fromEntries((await db.select().from(s.categories)).map((c) => [c.slug, c.id]));
  const sk = Object.fromEntries((await db.select().from(s.skills)).map((x) => [x.name, x.id]));
  const now = new Date();
  const mk = async (email: string, fullName: string, kind: "worker" | "business" | "admin", adminRole?: any) =>
    (await db.insert(s.users).values({ email, fullName, kind, adminRole, passwordHash: pw, emailVerifiedAt: now, isDemo: true }).onConflictDoNothing().returning())[0]
    ?? (await db.select().from(s.users).where(eq(s.users.email, email)))[0];

  // Admins (one per role so permissions can be exercised)
  for (const [email, name, role] of [["admin@demo.test", "Demo Super Admin", "super_admin"], ["moderator@demo.test", "Demo Moderator", "content_moderator"], ["verifier@demo.test", "Demo Verification Officer", "verification_officer"], ["finance@demo.test", "Demo Finance Admin", "finance_admin"], ["analyst@demo.test", "Demo Analyst", "read_only_analyst"]] as const)
    await mk(email, name, "admin", role);

  // Workers (fictional)
  const W = [
    { email: "priya@demo.test", name: "Priya Nair", headline: "Experienced virtual assistant & spreadsheet specialist", summary: "Former operations coordinator returning to work part-time around school hours. Strong with Excel, scheduling and inbox management.", skills: ["Virtual assistance", "Excel", "Email management", "Scheduling", "Data entry"], arr: ["remote", "hybrid"], area: "calgary-nw", level: "experienced", av: [1, 2, 3, 4, 5].map((d) => [d, 570, 840]), rate: [3000, 2500] },
    { email: "walter@demo.test", name: "Walter Eklund", headline: "Retired accountant offering bookkeeping & mentoring", summary: "35 years in small-business accounting. Available for bookkeeping support, invoice processing and mentoring new owners.", skills: ["Bookkeeping support", "Accounting support", "Invoice processing", "Business mentoring"], arr: ["remote", "local"], area: "calgary-sw", level: "expert", av: [2, 3, 4].map((d) => [d, 540, 960]), rate: [5500, 4500] },
    { email: "amara@demo.test", name: "Amara Okafor", headline: "University student — social media & content creation", summary: "Marketing student creating short-form content and managing small-brand social accounts. Evenings and weekends.", skills: ["Social media management", "Content creation", "Copywriting", "Graphic design"], arr: ["remote"], area: "calgary-downtown", level: "intermediate", av: [[0, 600, 1080], [6, 600, 1080], [1, 1140, 1320], [3, 1140, 1320]], rate: [2200, 1800] },
    { email: "jordan@demo.test", name: "Jordan Whitehorse", headline: "Reliable event & warehouse support", summary: "Experienced with event setup, stock counts and packaging. Own transportation, available weekends and weekday mornings.", skills: ["Event setup", "Inventory counting", "Product packaging", "Warehouse support", "Stock organisation"], arr: ["local"], area: "calgary-ne", level: "intermediate", av: [[6, 480, 1020], [0, 480, 1020], [2, 420, 780]], rate: [2300, 2000] },
    { email: "sam@demo.test", name: "Sam Taylor", headline: "Data analyst taking on short projects", summary: "Independent analyst: dashboards, data cleaning and CRM reporting for small teams.", skills: ["Data analysis", "Excel", "CRM administration", "Spreadsheet work", "Research"], arr: ["remote", "hybrid"], area: "calgary-se", level: "experienced", av: [1, 2, 3, 4, 5].map((d) => [d, 1080, 1320]), rate: [4500, 4000] },
  ];
  const wid: Record<string, string> = {};
  for (const w of W) {
    const u = await mk(w.email, w.name, "worker");
    wid[w.email] = u.id;
    await db.insert(s.workerProfiles).values({ userId: u.id, headline: w.headline, summary: w.summary, city: "Calgary", serviceAreaId: area[w.area], arrangements: w.arr, experienceLevel: w.level as any, preferredHourlyCents: w.rate[0], minHourlyCents: w.rate[1], maxHoursPerWeek: 20, travelRadiusKm: 20, onboardingCompletedAt: now, onboardingStep: 7, languages: ["English"] }).onConflictDoNothing();
    await db.insert(s.workerSkills).values(w.skills.map((n) => ({ userId: u.id, skillId: sk[n] }))).onConflictDoNothing();
    await db.insert(s.workerAvailability).values(w.av.map(([weekday, startMinute, endMinute]) => ({ userId: u.id, weekday, startMinute, endMinute }))).onConflictDoNothing();
    await db.insert(s.verifications).values({ userId: u.id, type: "email", status: "verified", provider: "email_link", decidedAt: now }).onConflictDoNothing();
  }

  // Businesses (fictional)
  const B = [
    { email: "owner@maple.demo.test", owner: "Dana Whitfield", name: "Maple & Pine Bakery (demo)", industry: "Food & beverage", verified: "verified" as const },
    { email: "owner@northgate.demo.test", owner: "Chris Lau", name: "Northgate Property Services (demo)", industry: "Property management", verified: "submitted" as const },
    { email: "owner@pixelcart.demo.test", owner: "Elena Marsh", name: "PixelCart Online (demo)", industry: "E-commerce", verified: "not_started" as const },
  ];
  const bid: Record<string, { b: string; u: string }> = {};
  for (const b of B) {
    const u = await mk(b.email, b.owner, "business");
    const [ex] = await db.select().from(s.businessMembers).where(eq(s.businessMembers.userId, u.id));
    let id = ex?.businessId;
    if (!id) {
      const [row] = await db.insert(s.businesses).values({ name: b.name, industry: b.industry, city: "Calgary", serviceAreaId: area["calgary-downtown"], verificationStatus: b.verified, isDemo: true, description: "Fictional demonstration business — not a real customer.", contactEmail: b.email }).returning();
      id = row.id; await db.insert(s.businessMembers).values({ businessId: id, userId: u.id, role: "owner" });
    }
    bid[b.email] = { b: id, u: u.id };
  }

  const existing = await db.select({ t: s.opportunities.title }).from(s.opportunities).where(eq(s.opportunities.isDemo, true));
  if (existing.length === 0) {
    const mkOpp = async (biz: string, o: any, skillNames: string[], mandatory: string[] = [], sched: number[][] = []) => {
      const [row] = await db.insert(s.opportunities).values({ businessId: bid[biz].b, createdBy: bid[biz].u, status: "published", publishedAt: now, isDemo: true, ...o }).returning();
      if (skillNames.length) await db.insert(s.opportunitySkills).values(skillNames.map((n) => ({ opportunityId: row.id, skillId: sk[n], mandatory: mandatory.includes(n) })));
      if (sched.length) await db.insert(s.opportunitySchedules).values(sched.map(([weekday, startMinute, endMinute]) => ({ opportunityId: row.id, weekday, startMinute, endMinute })));
      return row;
    };
    const m = "owner@maple.demo.test", n = "owner@northgate.demo.test", p = "owner@pixelcart.demo.test";
    const o1 = await mkOpp(m, { title: "Bookkeeping catch-up & invoice processing", description: "Bring our books up to date: enter this quarter's invoices, reconcile the bank feed and prepare a short summary for our accountant. Experience with small-business bookkeeping is essential.", engagementType: "micro_task", categoryId: cat["administration-business-support"], arrangement: "remote", payType: "hourly", payMinCents: 3000, payMaxCents: 4000, estimatedHours: 8, experienceLevel: "experienced", deliverables: "Reconciled books and a short summary" }, ["Bookkeeping support", "Invoice processing"], ["Bookkeeping support"], [[2, 600, 840]]);
    await mkOpp(m, { title: "Saturday farmers-market stall assistant", description: "Help set up and run our market stall: unloading, display setup, customer service and cash-free sales through our tablet. Training provided on site.", engagementType: "flexible_shift", categoryId: cat["physical-operational-work"], arrangement: "local", serviceAreaId: area["calgary-sw"], locationNote: "Southwest Calgary market (exact location shared after booking)", payType: "shift", payMinCents: 12000, payMaxCents: 12000, equipment: "Closed-toe shoes", experienceLevel: "entry", workersNeeded: 2, cancellationTerms: "Free cancellation up to 48 hours before the shift." }, ["Event setup", "Customer support"], [], [[6, 420, 840]]);
    await mkOpp(n, { title: "Quarterly inventory count — office supplies", description: "Count and record stock across three storage rooms and enter results into our spreadsheet. Estimated one day of work; a checklist is provided.", engagementType: "micro_task", categoryId: cat["physical-operational-work"], arrangement: "local", serviceAreaId: area["calgary-ne"], payType: "fixed", payMinCents: 18000, payMaxCents: 22000, estimatedHours: 6, deliverables: "Completed count sheet uploaded as a spreadsheet", experienceLevel: "entry" }, ["Inventory counting", "Excel"]);
    await mkOpp(n, { title: "Tenant communications & scheduling assistant", description: "Answer routine tenant emails, schedule maintenance visits and keep our shared calendar tidy. Weekday mornings work best.", engagementType: "recurring", categoryId: cat["administration-business-support"], arrangement: "remote", payType: "hourly", payMinCents: 2400, payMaxCents: 2800, hoursPerWeek: 10, recurring: true, recurrenceNote: "Mon–Thu mornings, 3 months, renewable", experienceLevel: "intermediate", startDate: new Date().toISOString().slice(0, 10), endDate: new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10) }, ["Email management", "Scheduling", "Virtual assistance"], ["Email management"], [[1, 570, 720], [2, 570, 720], [3, 570, 720], [4, 570, 720]]);
    await mkOpp(p, { title: "Enter 150 products into our online store", description: "Add 150 products from a supplier spreadsheet to our store, including titles, descriptions and category tags. We provide the template and style guide.", engagementType: "fixed_project", categoryId: cat["digital-creative"], arrangement: "remote", payType: "fixed", payMinCents: 30000, payMaxCents: 40000, estimatedHours: 15, startDate: "2026-12-01", endDate: "2026-12-20", deliverables: "150 published products reviewed against our style guide", experienceLevel: "entry" }, ["Product listing", "Data entry"], ["Data entry"]);
    await mkOpp(p, { title: "Monthly social media content calendar", description: "Plan and schedule a month of posts for our brand accounts, with captions and image briefs. You will report on engagement at month end.", engagementType: "recurring", categoryId: cat["digital-creative"], arrangement: "remote", payType: "recurring", payMinCents: 60000, payMaxCents: 80000, hoursPerWeek: 5, recurring: true, recurrenceNote: "Monthly, 6 months", experienceLevel: "intermediate", deliverables: "Monthly calendar, captions and a short report" }, ["Social media management", "Content creation", "Copywriting"], [], [[1, 1140, 1320]]);
    await mkOpp(p, { title: "CRM clean-up and reporting dashboard", description: "Our CRM has duplicate contacts and inconsistent fields. De-duplicate, standardise and build a simple monthly pipeline report we can maintain ourselves.", engagementType: "specialist_consultation", categoryId: cat["specialist-expertise"], arrangement: "hybrid", serviceAreaId: area["calgary-downtown"], payType: "hourly", payMinCents: 4500, payMaxCents: 6000, estimatedHours: 20, experienceLevel: "experienced" }, ["CRM administration", "Data analysis"], ["CRM administration"]);
    await db.insert(s.applications).values({ opportunityId: o1.id, workerId: wid["walter@demo.test"], status: "under_review", proposal: "I ran a small-business bookkeeping practice for many years and can start next week. Demo application.", proposedRateCents: 4000 });
  }
  // Work-sharing demo: four part-time workers who together can cover a 30 h/week support desk (fictional).
  const CS = [
    { email: "lena@demo.test", name: "Lena Park", av: [[1, 540, 900], [2, 540, 900]], max: 12 },
    { email: "marcus@demo.test", name: "Marcus Bell", av: [[3, 540, 900], [4, 540, 720]], max: 10 },
    { email: "ines@demo.test", name: "Ines Moreau", av: [[4, 720, 900], [5, 540, 720]], max: 10 },
    { email: "tomas@demo.test", name: "Tomas Novak", av: [[5, 720, 900]], max: 5 },
  ];
  for (const w of CS) {
    const u = await mk(w.email, w.name, "worker");
    await db.insert(s.workerProfiles).values({ userId: u.id, headline: "Customer support agent (part-time, demo)", summary: "Fictional demo profile: experienced support agent available a few set hours each week.", city: "Calgary", serviceAreaId: area["calgary-nw"], arrangements: ["remote"], experienceLevel: "intermediate", maxHoursPerWeek: w.max, onboardingCompletedAt: now, onboardingStep: 7, languages: ["English"] }).onConflictDoNothing();
    await db.insert(s.workerSkills).values([{ userId: u.id, skillId: sk["Customer support"] }, { userId: u.id, skillId: sk["Chat support"] }]).onConflictDoNothing();
    await db.insert(s.workerAvailability).values(w.av.map(([weekday, startMinute, endMinute]) => ({ userId: u.id, weekday, startMinute, endMinute }))).onConflictDoNothing();
    await db.insert(s.verifications).values({ userId: u.id, type: "email", status: "verified", provider: "email_link", decidedAt: now }).onConflictDoNothing();
  }
  const mapleBiz = bid["owner@maple.demo.test"];
  const [hasDesk] = await db.select().from(s.opportunities).where(eq(s.opportunities.title, "Shared customer support desk (demo)"));
  if (!hasDesk) {
    const [desk] = await db.insert(s.opportunities).values({ businessId: mapleBiz.b, createdBy: mapleBiz.u, status: "published", publishedAt: now, isDemo: true, title: "Shared customer support desk (demo)", description: "Thirty hours a week of customer support, shared between several people who each cover set hours. Demonstration listing.", engagementType: "recurring", categoryId: cat["customer-service"], arrangement: "remote", payType: "hourly", payMinCents: 2400, payMaxCents: 2800, hoursPerWeek: 30, recurring: true, recurrenceNote: "Mon–Fri 9:00–15:00, ongoing", experienceLevel: "intermediate" }).returning();
    await db.insert(s.opportunitySkills).values({ opportunityId: desk.id, skillId: sk["Customer support"], mandatory: true });
    await db.insert(s.opportunitySchedules).values([1, 2, 3, 4, 5].map((weekday) => ({ opportunityId: desk.id, weekday, startMinute: 540, endMinute: 900 })));
  }
  console.log("Seeded. Demo password for all demo accounts:", DEMO_PASSWORD);
  await getPool().end();
}
main().catch((e) => { console.error(e); process.exit(1); });

// DEMO ONLY: after `npm run db:seed`, creates in-flight marketplace activity (applications, an assignment with messages, a recurring
// assignment with a pending renewal, partially-confirmed shared coverage) by calling the real services, so screens are not empty.
import "./env";
import { eq, like } from "drizzle-orm";
import { db, getPool } from "../src/server/db/client";
import * as s from "../src/server/db/schema";
import { applyToOpportunity, businessSetApplicationStatus, workerSetApplicationStatus } from "../src/server/services/applications";
import { startConversation, sendMessage } from "../src/server/services/messaging";
import { suggest, proposeSlices, respondToSlice, listWorkerCoverage, releaseSlice } from "../src/server/services/coverage";
import { proposeRenewal } from "../src/server/services/recurring";

if (process.env.NODE_ENV === "production") throw new Error("Refusing to create demo activity in production");
const uid = async (email: string) => (await db.select().from(s.users).where(eq(s.users.email, email)))[0].id;
const opp = async (titleLike: string) => (await db.select().from(s.opportunities).where(like(s.opportunities.title, titleLike)))[0];
const iso = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

async function main() {
  const [priya, sam, maple, pixel, north] = await Promise.all(["priya@demo.test", "sam@demo.test", "owner@maple.demo.test", "owner@pixelcart.demo.test", "owner@northgate.demo.test"].map(uid));
  const book = await opp("Bookkeeping catch-up%"), products = await opp("Enter 150 products%"), tenant = await opp("Tenant communications%"), desk = await opp("Shared customer support desk%");

  // 1. A shortlisted applicant in Maple's pipeline
  const a1 = await applyToOpportunity(priya, { opportunityId: book.id, proposal: "I ran operations for a regional firm for eight years and keep clean, reconciled books. I can start next week and work around school hours.", proposedRate: 36 });
  await businessSetApplicationStatus(maple, a1.id, "shortlisted");

  // 2. An accepted fixed-fee project with a message thread
  const a2 = await applyToOpportunity(sam, { opportunityId: products.id, proposal: "I clean and load product data regularly and will follow your style guide exactly. Happy to share a sample batch first." });
  await businessSetApplicationStatus(pixel, a2.id, "offer_received"); await workerSetApplicationStatus(sam, a2.id, "accepted");
  const conv = await startConversation(pixel, sam); await sendMessage(pixel, conv, "Welcome aboard! The supplier spreadsheet and our style guide are in the shared folder — start with the first 30 products so we can check the format together.");
  await sendMessage(sam, conv, "Thanks! I'll send the first batch by Thursday and flag anything unclear in the supplier data.");

  // 3. A recurring assignment (sessions are generated) with a renewal offer waiting for the worker
  const a3 = await applyToOpportunity(priya, { opportunityId: tenant.id, proposal: "I coordinate inboxes and calendars every week and can cover the Monday–Thursday mornings.", proposedRate: 29 });
  await businessSetApplicationStatus(north, a3.id, "offer_received"); await workerSetApplicationStatus(priya, a3.id, "accepted");
  const [asg] = await db.select().from(s.assignments).where(eq(s.assignments.applicationId, a3.id));
  const { getRecurringView } = await import("../src/server/services/recurring"); await getRecurringView(priya, asg.id);
  await proposeRenewal(north, asg.id, { newEndDate: iso(63), newRate: 31, note: "Happy with how this is going — would you continue through the winter?" });

  // 4. Shared coverage: three workers confirmed, one proposal still pending, one slice given back (a visible gap)
  const sug = await suggest(maple, desk.id); await proposeSlices(maple, desk.id, sug.suggestions);
  for (const email of ["lena@demo.test", "marcus@demo.test", "ines@demo.test"]) { const w = await uid(email); for (const it of (await listWorkerCoverage(w)).items) await respondToSlice(w, it.s.id, "confirm"); }
  const marcus = await uid("marcus@demo.test"); const wed = (await listWorkerCoverage(marcus)).items.find((i) => i.s.weekday === 3);
  if (wed) await releaseSlice(marcus, wed.s.id, "Childcare fell through for Wednesdays");
  console.log("Demo activity created.");
  await getPool().end();
}
main().catch((e) => { console.error(e); process.exit(1); });

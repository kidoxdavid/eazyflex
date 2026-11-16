import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { applicationStatusHistory, applications, businesses, notifications, opportunities, users } from "../db/schema";
import { audit } from "../audit";
import { ServiceError } from "./identity";
import { assertBusinessMember } from "./opportunities";
import { matchWorkerToOpportunity } from "./matching";

type Status = typeof applications.$inferSelect["status"];

const TERMINAL: Status[] = ["accepted", "declined", "withdrawn", "expired"];
/** Statuses a business may move an application to, by current status. */
export const BUSINESS_TRANSITIONS: Partial<Record<Status, Status[]>> = {
  submitted: ["under_review", "shortlisted", "interview_requested", "offer_received", "declined"],
  under_review: ["shortlisted", "interview_requested", "offer_received", "declined"],
  shortlisted: ["interview_requested", "offer_received", "declined"],
  interview_requested: ["shortlisted", "offer_received", "declined"],
  offer_received: ["declined"],
};
/** Statuses a worker may move their own application to. */
export const WORKER_TRANSITIONS: Partial<Record<Status, Status[]>> = {
  submitted: ["withdrawn"], under_review: ["withdrawn"], shortlisted: ["withdrawn"],
  interview_requested: ["withdrawn"], offer_received: ["accepted", "declined", "withdrawn"],
};

export const applySchema = z.object({
  opportunityId: z.string().uuid(),
  proposal: z.string().trim().min(30, "Tell the business why you are a good fit (at least 30 characters)").max(4000),
  proposedRate: z.coerce.number().positive().max(100000).optional().or(z.literal("")).transform((v) => (v === "" ? undefined : v)),
  availabilityNote: z.string().trim().max(1000).optional(),
});

async function notify(userId: string, type: string, title: string, body: string, href: string) {
  await db.insert(notifications).values({ userId, type, title, body, href });
}

export async function applyToOpportunity(workerId: string, raw: unknown) {
  const i = applySchema.parse(raw);
  const [w] = await db.select().from(users).where(eq(users.id, workerId)).limit(1);
  if (!w || w.kind !== "worker") throw new ServiceError("Only workers can apply", "forbidden");
  if (!w.emailVerifiedAt) throw new ServiceError("Verify your email address before applying", "forbidden");
  const [o] = await db.select({ o: opportunities, b: businesses }).from(opportunities).innerJoin(businesses, eq(businesses.id, opportunities.businessId)).where(eq(opportunities.id, i.opportunityId)).limit(1);
  if (!o || o.o.status !== "published" || o.b.status !== "active") throw new ServiceError("This opportunity is not open for applications", "not_found");
  if (o.o.applicationDeadline && o.o.applicationDeadline < new Date().toISOString().slice(0, 10)) throw new ServiceError("The application deadline has passed");

  // Informational snapshot only — it never blocks an application and is not shown as a decision.
  const match = await matchWorkerToOpportunity(workerId, i.opportunityId).catch(() => null);

  try {
    return await db.transaction(async (tx) => {
      const [a] = await tx.insert(applications).values({
        opportunityId: i.opportunityId, workerId, status: "submitted", proposal: i.proposal,
        proposedRateCents: i.proposedRate ? Math.round(i.proposedRate * 100) : null, availabilityNote: i.availabilityNote ?? null,
        matchScore: match?.eligible ? match.score : null, matchSnapshot: match ?? null,
      }).returning();
      await tx.insert(applicationStatusHistory).values({ applicationId: a.id, fromStatus: null, toStatus: "submitted", actorId: workerId });
      await audit(workerId, "application.submitted", "application", a.id, { opportunityId: i.opportunityId }, tx);
      return a;
    }).then(async (a) => {
      const owners = await db.execute(sql`select user_id from business_members where business_id = ${o.o.businessId}`);
      for (const r of owners.rows as { user_id: string }[]) await notify(r.user_id, "application_new", "New application", `${w.fullName} applied to “${o.o.title}”`, `/business/opportunities/${o.o.id}`);
      return a;
    });
  } catch (e: any) {
    if (e?.code === "23505" || e?.cause?.code === "23505") throw new ServiceError("You have already applied to this opportunity", "conflict");
    throw e;
  }
}

async function transition(appId: string, actorId: string, to: Status, side: "worker" | "business", note?: string) {
  const [row] = await db.select({ a: applications, o: opportunities }).from(applications).innerJoin(opportunities, eq(opportunities.id, applications.opportunityId)).where(eq(applications.id, appId)).limit(1);
  if (!row) throw new ServiceError("Application not found", "not_found");
  if (side === "worker") {
    if (row.a.workerId !== actorId) throw new ServiceError("Application not found", "not_found"); // do not reveal existence
  } else await assertBusinessMember(actorId, row.o.businessId).catch(() => { throw new ServiceError("Application not found", "not_found"); });
  const table = side === "worker" ? WORKER_TRANSITIONS : BUSINESS_TRANSITIONS;
  if (!table[row.a.status]?.includes(to)) throw new ServiceError(`Cannot change an application from ${row.a.status.replace(/_/g, " ")} to ${to.replace(/_/g, " ")}`);
  if (to === "accepted" && row.o.status !== "published") throw new ServiceError("This opportunity is no longer open");

  await db.transaction(async (tx) => {
    // Lock the opportunity so concurrent acceptances cannot exceed workersNeeded.
    await tx.execute(sql`select 1 from opportunities where id = ${row.o.id} for update`);
    const [fresh] = await tx.select({ s: applications.status }).from(applications).where(eq(applications.id, appId)).for("update");
    if (fresh.s !== row.a.status) throw new ServiceError("This application was just updated. Refresh and try again.", "conflict");
    await tx.update(applications).set({ status: to, updatedAt: new Date() }).where(eq(applications.id, appId));
    await tx.insert(applicationStatusHistory).values({ applicationId: appId, fromStatus: row.a.status, toStatus: to, actorId, note: note ?? null });
    if (to === "accepted") {
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(applications).where(and(eq(applications.opportunityId, row.o.id), eq(applications.status, "accepted")));
      if (n >= row.o.workersNeeded) await tx.update(opportunities).set({ status: "filled", updatedAt: new Date() }).where(eq(opportunities.id, row.o.id));
    }
    await audit(actorId, `application.${to}`, "application", appId, { from: row.a.status }, tx);
  });
  return row;
}

const LABEL: Partial<Record<Status, string>> = { under_review: "is under review", shortlisted: "was shortlisted", interview_requested: "has an interview request", offer_received: "received an offer", declined: "was declined" };

export async function businessSetApplicationStatus(userId: string, appId: string, to: Status, note?: string) {
  const row = await transition(appId, userId, to, "business", note);
  await notify(row.a.workerId, "application_update", "Application update", `Your application for “${row.o.title}” ${LABEL[to] ?? "was updated"}.`, "/worker/applications");
}

export async function workerSetApplicationStatus(userId: string, appId: string, to: Status) {
  const row = await transition(appId, userId, to, "worker");
  const owners = await db.execute(sql`select user_id from business_members where business_id = ${row.o.businessId}`);
  for (const r of owners.rows as { user_id: string }[]) await notify(r.user_id, "application_update", `Application ${to}`, `A candidate ${to} their application for “${row.o.title}”.`, `/business/opportunities/${row.o.id}`);
}

export async function saveBusinessNote(userId: string, appId: string, note: string) {
  const [row] = await db.select({ o: opportunities }).from(applications).innerJoin(opportunities, eq(opportunities.id, applications.opportunityId)).where(eq(applications.id, appId)).limit(1);
  if (!row) throw new ServiceError("Application not found", "not_found");
  await assertBusinessMember(userId, row.o.businessId);
  await db.update(applications).set({ businessNote: note.slice(0, 2000) }).where(eq(applications.id, appId));
}

export async function listWorkerApplications(workerId: string) {
  return db.select({ a: applications, title: opportunities.title, oppId: opportunities.id, businessName: businesses.name })
    .from(applications).innerJoin(opportunities, eq(opportunities.id, applications.opportunityId)).innerJoin(businesses, eq(businesses.id, opportunities.businessId))
    .where(eq(applications.workerId, workerId)).orderBy(desc(applications.updatedAt));
}

export async function applicationHistory(appId: string) {
  return db.select().from(applicationStatusHistory).where(eq(applicationStatusHistory.applicationId, appId)).orderBy(applicationStatusHistory.createdAt);
}
export const isTerminal = (s: Status) => TERMINAL.includes(s);

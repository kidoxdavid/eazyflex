import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { applications, businessMembers, businesses, opportunities, users, verifications, workerProfiles, workerSkills, skills, serviceAreas } from "../db/schema";
import { ServiceError } from "./identity";
import { assertBusinessPermission } from "./opportunities";
import { audit } from "../audit";
import { privateName } from "./matching";

export async function getBusinessForUser(userId: string) {
  const [r] = await db.select({ b: businesses, role: businessMembers.role }).from(businessMembers).innerJoin(businesses, eq(businesses.id, businessMembers.businessId)).where(eq(businessMembers.userId, userId)).limit(1);
  return r ?? null;
}

export const businessProfileSchema = z.object({
  name: z.string().trim().min(2).max(160), industry: z.string().trim().max(80).optional(), businessType: z.string().trim().max(80).optional(),
  description: z.string().trim().max(2000).optional(), website: z.string().trim().url().max(300).optional().or(z.literal("")),
  contactEmail: z.string().trim().email().max(254).optional().or(z.literal("")), sizeBand: z.string().trim().max(40).optional(),
  city: z.string().trim().max(80).optional(), serviceAreaId: z.string().uuid().optional().or(z.literal("")),
});

export async function saveBusinessProfile(userId: string, businessId: string, raw: unknown) {
  await assertBusinessPermission(userId, businessId, "profile.edit");
  const i = businessProfileSchema.parse(raw);
  await db.update(businesses).set({ ...i, website: i.website || null, contactEmail: i.contactEmail || null, serviceAreaId: i.serviceAreaId || null, updatedAt: new Date() }).where(eq(businesses.id, businessId));
}

/** Business verification is a manual review workflow: submission creates a queue item; only a Verification Officer can verify. */
export async function submitBusinessVerification(userId: string, businessId: string, evidenceNote: string) {
  await assertBusinessPermission(userId, businessId, "verification.submit");
  if (evidenceNote.trim().length < 10) throw new ServiceError("Describe how we can verify the business (registration number, website, or similar)");
  const [b] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (b.verificationStatus === "verified" || b.verificationStatus === "submitted") throw new ServiceError("Verification is already " + b.verificationStatus);
  await db.transaction(async (tx) => {
    await tx.insert(verifications).values({ businessId, userId, type: "business", status: "submitted", provider: "manual_review", notes: evidenceNote.slice(0, 1000) });
    await tx.update(businesses).set({ verificationStatus: "submitted", updatedAt: new Date() }).where(eq(businesses.id, businessId));
    await audit(userId, "business.verification_submitted", "business", businessId, undefined, tx);
  });
}

export const talentFilterSchema = z.object({ q: z.string().max(100).optional(), skill: z.string().uuid().optional(), arrangement: z.enum(["remote", "local", "hybrid"]).optional(), area: z.string().uuid().optional(), maxRate: z.coerce.number().positive().optional() });

/**
 * Talent directory for businesses. Privacy: only workers who completed onboarding, verified email and opted in
 * (publicProfile). Exposes first name + last initial, headline, area, skills and rates — never email, phone, address or documents.
 */
export async function browseTalent(userId: string, f: z.infer<typeof talentFilterSchema>) {
  const m = await getBusinessForUser(userId);
  if (!m) throw new ServiceError("No business account", "forbidden");
  const conds = [eq(workerProfiles.publicProfile, true), sql`${workerProfiles.onboardingCompletedAt} is not null`, eq(users.status, "active"), sql`${users.emailVerifiedAt} is not null`, eq(workerProfiles.availabilityPaused, false)];
  if (f.arrangement) conds.push(sql`${f.arrangement} = any(${workerProfiles.arrangements})`);
  if (f.area) conds.push(eq(workerProfiles.serviceAreaId, f.area));
  if (f.maxRate) conds.push(sql`(${workerProfiles.preferredHourlyCents} is null or ${workerProfiles.preferredHourlyCents} <= ${Math.round(f.maxRate * 100)})`);
  if (f.skill) conds.push(sql`exists (select 1 from worker_skills ws where ws.user_id = ${workerProfiles.userId} and ws.skill_id = ${f.skill})`);
  if (f.q) conds.push(sql`(${workerProfiles.headline} ilike ${"%" + f.q + "%"} or ${workerProfiles.summary} ilike ${"%" + f.q + "%"})`);
  const rows = await db.select({ p: workerProfiles, name: users.fullName, areaName: serviceAreas.name, emailVerified: users.emailVerifiedAt })
    .from(workerProfiles).innerJoin(users, eq(users.id, workerProfiles.userId)).leftJoin(serviceAreas, eq(serviceAreas.id, workerProfiles.serviceAreaId))
    .where(and(...conds)).limit(60);
  const ids = rows.map((r) => r.p.userId);
  const sk = ids.length ? await db.select({ userId: workerSkills.userId, name: skills.name }).from(workerSkills).innerJoin(skills, eq(skills.id, workerSkills.skillId)).where(inArray(workerSkills.userId, ids)) : [];
  const ver = ids.length ? await db.select({ userId: verifications.userId, type: verifications.type }).from(verifications).where(and(inArray(verifications.userId, ids), eq(verifications.status, "verified"))) : [];
  return rows.map((r) => ({
    workerId: r.p.userId, displayName: privateName(r.name), headline: r.p.headline, summary: r.p.summary, area: r.areaName, arrangements: r.p.arrangements,
    experienceLevel: r.p.experienceLevel, preferredHourlyCents: r.p.preferredHourlyCents, languages: r.p.languages,
    skills: sk.filter((s) => s.userId === r.p.userId).map((s) => s.name),
    verified: ver.filter((v) => v.userId === r.p.userId).map((v) => v.type), // only genuinely verified checks
  }));
}

export async function listBusinessOpportunities(businessId: string) {
  return db.select({ o: opportunities, applicants: sql<number>`(select count(*)::int from applications a where a.opportunity_id = "opportunities"."id")` })
    .from(opportunities).where(eq(opportunities.businessId, businessId)).orderBy(sql`${opportunities.createdAt} desc`);
}

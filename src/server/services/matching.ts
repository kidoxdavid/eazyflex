import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  matchingRules, opportunities, opportunitySchedules, opportunitySkills, serviceAreas, skills, users,
  workerAvailability, workerProfiles, workerSkills, workerUnavailability, applications, businesses, verifications,
} from "../db/schema";
import { DEFAULT_RULES, scoreMatch, type MatchOpportunity, type MatchResult, type MatchRules, type MatchWorker } from "../matching/score";
import { assertBusinessMember } from "./opportunities";

export async function loadActiveRules(): Promise<MatchRules & { version: number }> {
  const [r] = await db.select().from(matchingRules).where(eq(matchingRules.active, true)).limit(1);
  if (!r) return { ...DEFAULT_RULES, version: 0 };
  const t = r.thresholds as any;
  return { weights: r.weights as any, thresholds: { recommend: t.recommend, strong: t.strong }, mandatory: t.mandatory ?? DEFAULT_RULES.mandatory, version: r.version };
}

const num = (v: string | null | undefined) => (v == null ? null : Number(v));

export async function loadWorkers(ids: string[]): Promise<Map<string, MatchWorker>> {
  if (!ids.length) return new Map();
  const [profiles, sk, av, un] = await Promise.all([
    db.select({ p: workerProfiles, lat: serviceAreas.lat, lng: serviceAreas.lng }).from(workerProfiles).leftJoin(serviceAreas, eq(serviceAreas.id, workerProfiles.serviceAreaId)).where(inArray(workerProfiles.userId, ids)),
    db.select().from(workerSkills).where(inArray(workerSkills.userId, ids)),
    db.select().from(workerAvailability).where(inArray(workerAvailability.userId, ids)),
    db.select().from(workerUnavailability).where(inArray(workerUnavailability.userId, ids)),
  ]);
  const out = new Map<string, MatchWorker>();
  for (const { p, lat, lng } of profiles) {
    out.set(p.userId, {
      arrangements: p.arrangements, engagementTypes: p.engagementTypes, categoryIds: p.categoryIds,
      skillIds: sk.filter((s) => s.userId === p.userId).map((s) => s.skillId),
      experienceLevel: p.experienceLevel, area: lat && lng ? { lat: Number(lat), lng: Number(lng) } : null,
      travelRadiusKm: p.travelRadiusKm,
      availability: av.filter((a) => a.userId === p.userId).map((a) => ({ weekday: a.weekday, startMinute: a.startMinute, endMinute: a.endMinute })),
      unavailability: un.filter((u) => u.userId === p.userId).map((u) => ({ start: u.startDate, end: u.endDate })),
      availabilityPaused: p.availabilityPaused, maxHoursPerWeek: p.maxHoursPerWeek,
      minAssignmentDays: p.minAssignmentDays, maxAssignmentDays: p.maxAssignmentDays,
      preferredHourlyCents: p.preferredHourlyCents, minHourlyCents: p.minHourlyCents, minHourlyIsHard: p.minHourlyIsHard,
      preferredFixedCents: p.preferredFixedCents, willingToNegotiate: p.willingToNegotiate,
    });
  }
  return out;
}

export async function loadOpportunities(ids: string[]): Promise<Map<string, MatchOpportunity>> {
  if (!ids.length) return new Map();
  const [rows, sk, sched] = await Promise.all([
    db.select({ o: opportunities, lat: serviceAreas.lat, lng: serviceAreas.lng, areaName: serviceAreas.name }).from(opportunities).leftJoin(serviceAreas, eq(serviceAreas.id, opportunities.serviceAreaId)).where(inArray(opportunities.id, ids)),
    db.select({ opportunityId: opportunitySkills.opportunityId, skillId: opportunitySkills.skillId, name: skills.name, mandatory: opportunitySkills.mandatory }).from(opportunitySkills).innerJoin(skills, eq(skills.id, opportunitySkills.skillId)).where(inArray(opportunitySkills.opportunityId, ids)),
    db.select().from(opportunitySchedules).where(inArray(opportunitySchedules.opportunityId, ids)),
  ]);
  return new Map(rows.map(({ o, lat, lng, areaName }) => [o.id, {
    arrangement: o.arrangement, engagementType: o.engagementType, categoryId: o.categoryId, payType: o.payType,
    payMinCents: o.payMinCents, payMaxCents: o.payMaxCents, experienceLevel: o.experienceLevel,
    skills: sk.filter((s) => s.opportunityId === o.id).map(({ skillId, name, mandatory }) => ({ skillId, name, mandatory })),
    schedule: sched.filter((s) => s.opportunityId === o.id).map(({ weekday, startMinute, endMinute }) => ({ weekday, startMinute, endMinute })),
    startDate: o.startDate, endDate: o.endDate, hoursPerWeek: o.hoursPerWeek,
    area: lat && lng ? { lat: Number(lat), lng: Number(lng), name: areaName ?? undefined } : null,
  } satisfies MatchOpportunity]));
}

export async function matchWorkerToOpportunity(workerId: string, opportunityId: string): Promise<MatchResult & { rulesVersion: number }> {
  const [rules, ws, os] = await Promise.all([loadActiveRules(), loadWorkers([workerId]), loadOpportunities([opportunityId])]);
  const w = ws.get(workerId), o = os.get(opportunityId);
  if (!w || !o) throw new Error("Worker or opportunity not found");
  return { ...scoreMatch(o, w, rules), rulesVersion: rules.version };
}

/** Recommended opportunities for a worker, best first. Ineligible matches are never recommended. */
export async function recommendForWorker(workerId: string, limit = 20) {
  const [rules, ws] = await Promise.all([loadActiveRules(), loadWorkers([workerId])]);
  const w = ws.get(workerId);
  if (!w) return [];
  const open = await db.select({ id: opportunities.id }).from(opportunities).innerJoin(businesses, eq(businesses.id, opportunities.businessId))
    .where(and(eq(opportunities.status, "published"), eq(businesses.status, "active"),
      sql`(${opportunities.applicationDeadline} is null or ${opportunities.applicationDeadline} >= current_date)`,
      sql`not exists (select 1 from applications a where a.opportunity_id = ${opportunities.id} and a.worker_id = ${workerId})`))
    .orderBy(desc(opportunities.publishedAt)).limit(300);
  const oppMap = await loadOpportunities(open.map((r) => r.id));
  const scored = [...oppMap.entries()].map(([id, o]) => ({ id, result: scoreMatch(o, w, rules) }))
    .filter((x) => x.result.eligible && x.result.score >= rules.thresholds.recommend)
    .sort((a, b) => b.result.score - a.result.score).slice(0, limit);
  return scored;
}

/** Recommended workers for one of a business's own opportunities. Only workers who opted in to being discoverable. */
export async function recommendWorkersForOpportunity(userId: string, businessId: string, opportunityId: string, limit = 20) {
  await assertBusinessMember(userId, businessId);
  const [o] = await db.select({ id: opportunities.id }).from(opportunities).where(and(eq(opportunities.id, opportunityId), eq(opportunities.businessId, businessId))).limit(1);
  if (!o) return [];
  const candidates = await db.select({ id: workerProfiles.userId, name: users.fullName, headline: workerProfiles.headline, city: workerProfiles.city }).from(workerProfiles)
    .innerJoin(users, eq(users.id, workerProfiles.userId))
    .where(and(eq(workerProfiles.publicProfile, true), sql`${workerProfiles.onboardingCompletedAt} is not null`, eq(users.status, "active"), sql`${users.emailVerifiedAt} is not null`)).limit(500);
  const [rules, ws, os] = await Promise.all([loadActiveRules(), loadWorkers(candidates.map((c) => c.id)), loadOpportunities([opportunityId])]);
  const opp = os.get(opportunityId)!;
  const vers = await db.select({ userId: verifications.userId, type: verifications.type }).from(verifications).where(and(inArray(verifications.userId, candidates.map((c) => c.id)), eq(verifications.status, "verified")));
  return candidates.map((c) => ({ c, result: scoreMatch(opp, ws.get(c.id)!, rules), verified: vers.filter((v) => v.userId === c.id).map((v) => v.type) }))
    .filter((x) => x.result.eligible && x.result.score >= rules.thresholds.recommend)
    .sort((a, b) => b.result.score - a.result.score).slice(0, limit)
    .map((x) => ({ workerId: x.c.id, displayName: privateName(x.c.name), headline: x.c.headline, city: x.c.city, verified: x.verified, result: x.result }));
}

/** Businesses see "First L." — never full name, email, phone or address. */
export const privateName = (full: string) => {
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
};

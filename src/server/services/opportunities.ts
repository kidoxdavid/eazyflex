import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import {
  businesses, businessMembers, categories, opportunities, opportunityQuestions, opportunitySchedules, opportunitySkills, serviceAreas, skills, applications,
} from "../db/schema";
import { audit } from "../audit";
import { ServiceError } from "./identity";
import { canBiz, type BizPerm } from "../business-rbac";

export const ENGAGEMENT_LABELS: Record<string, string> = {
  micro_task: "Micro-task", fixed_project: "Fixed project", flexible_shift: "Flexible shift",
  recurring: "Recurring assignment", specialist_consultation: "Specialist consultation", local_service: "Local service",
};
export const PAY_LABELS: Record<string, string> = { hourly: "Hourly rate", fixed: "Fixed project fee", shift: "Per-shift pay", recurring: "Recurring pay" };
export const PAY_SUFFIX: Record<string, string> = { hourly: "/hour", fixed: " fixed", shift: " per shift", recurring: " per period" };

const COMPATIBLE_PAY: Record<string, string[]> = {
  micro_task: ["hourly", "fixed"], fixed_project: ["fixed"], flexible_shift: ["shift", "hourly"],
  recurring: ["recurring", "hourly"], specialist_consultation: ["hourly", "fixed"], local_service: ["fixed", "hourly", "shift"],
};

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")).transform((v) => v || undefined);

export const opportunitySchema = z.object({
  title: z.string().trim().min(8, "Title must be at least 8 characters").max(120),
  description: z.string().trim().min(50, "Describe the work in at least 50 characters").max(6000),
  responsibilities: z.string().trim().max(3000).optional(),
  engagementType: z.enum(["micro_task", "fixed_project", "flexible_shift", "recurring", "specialist_consultation", "local_service"]),
  categoryId: z.string().uuid(),
  arrangement: z.enum(["remote", "local", "hybrid"]),
  serviceAreaId: z.string().uuid().optional().or(z.literal("")).transform((v) => v || undefined),
  locationNote: z.string().trim().max(200).optional(),
  payType: z.enum(["hourly", "fixed", "shift", "recurring"]),
  payMin: z.coerce.number().positive("Enter a compensation amount").max(100000),
  payMax: z.coerce.number().positive().max(100000),
  estimatedHours: z.coerce.number().int().positive().max(5000).optional().or(z.literal("")).transform((v) => (v === "" ? undefined : v)),
  hoursPerWeek: z.coerce.number().int().positive().max(80).optional().or(z.literal("")).transform((v) => (v === "" ? undefined : v)),
  startDate: dateStr, endDate: dateStr, applicationDeadline: dateStr,
  workersNeeded: z.coerce.number().int().min(1).max(100).default(1),
  experienceLevel: z.enum(["entry", "intermediate", "experienced", "expert"]).default("entry"),
  recurrenceNote: z.string().trim().max(300).optional(),
  preferSameWorker: z.boolean().default(true),
  deliverables: z.string().trim().max(3000).optional(),
  equipment: z.string().trim().max(500).optional(),
  selectionProcess: z.string().trim().max(1000).optional(),
  cancellationTerms: z.string().trim().max(1000).optional(),
  qualificationsRequired: z.string().trim().max(500).optional(),
  skillIds: z.array(z.string().uuid()).max(15).default([]),
  mandatorySkillIds: z.array(z.string().uuid()).max(15).default([]),
  questions: z.array(z.object({ prompt: z.string().trim().min(5, "Each screening question needs at least 5 characters").max(300), required: z.boolean() })).max(5).default([]),
  schedule: z.array(z.object({ weekday: z.number().int().min(0).max(6), startMinute: z.number().int().min(0).max(1439), endMinute: z.number().int().min(1).max(1440) })
    .refine((s) => s.endMinute > s.startMinute, "Schedule end must be after start")).max(21).default([]),
});
export type OpportunityInput = z.infer<typeof opportunitySchema>;

/** Business rules that must hold before an opportunity can be saved for publication. */
export function validateOpportunityRules(i: OpportunityInput) {
  const errs: string[] = [];
  if (i.payMax < i.payMin) errs.push("Maximum compensation cannot be lower than the minimum");
  if (!COMPATIBLE_PAY[i.engagementType].includes(i.payType)) errs.push(`${ENGAGEMENT_LABELS[i.engagementType]} cannot use "${PAY_LABELS[i.payType]}" compensation`);
  if (i.payType === "hourly" && i.payMax > 1000) errs.push("Hourly rate looks too high — check the amount");
  if (i.payType === "fixed" && !(i.deliverables && i.deliverables.length >= 20)) errs.push("Fixed-fee work requires a defined scope: list the deliverables (at least 20 characters)");
  if ((i.arrangement === "local" || i.arrangement === "hybrid") && !i.serviceAreaId) errs.push("Choose an approximate work area for local or hybrid work");
  if (i.engagementType === "local_service" && i.arrangement === "remote") errs.push("A local service cannot be remote");
  if (i.engagementType === "recurring" && (!i.hoursPerWeek || !i.schedule.length)) errs.push("Recurring work needs hours per week and at least one scheduled day/time");
  if (i.engagementType === "flexible_shift" && !i.schedule.length) errs.push("A flexible shift needs at least one scheduled day/time");
  if (i.startDate && i.endDate && i.endDate < i.startDate) errs.push("End date cannot be before the start date");
  if (i.applicationDeadline && i.startDate && i.applicationDeadline > i.startDate) errs.push("Application deadline must be on or before the start date");
  if (i.mandatorySkillIds.some((s) => !i.skillIds.includes(s))) errs.push("Mandatory skills must be part of the requested skills");
  if (errs.length) throw new ServiceError(errs.join(". "));
}

export async function assertBusinessPermission(userId: string, businessId: string, perm: BizPerm) {
  const m = await assertBusinessMember(userId, businessId);
  if (!canBiz(m.role, perm)) throw new ServiceError(`Your role (${m.role}) can’t do this. Ask an owner${perm === "team.manage" || perm === "verification.submit" ? "" : " or manager"}.`, "forbidden");
  return m;
}

export async function assertBusinessMember(userId: string, businessId: string) {
  const [m] = await db.select().from(businessMembers).where(and(eq(businessMembers.userId, userId), eq(businessMembers.businessId, businessId))).limit(1);
  if (!m) throw new ServiceError("You do not have access to this business", "forbidden");
  return m;
}

export async function getModerationEnabled() {
  const r = await db.execute(sql`select value from platform_settings where key = 'moderation.all_postings'`);
  return (r.rows[0] as { value: unknown } | undefined)?.value === true;
}

export async function saveOpportunity(userId: string, businessId: string, raw: unknown, opts: { id?: string; publish: boolean }) {
  await assertBusinessPermission(userId, businessId, "opportunity.write");
  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!biz || biz.status !== "active") throw new ServiceError("This business account is not active", "forbidden");
  const i = opportunitySchema.parse(raw);
  if (opts.publish) validateOpportunityRules(i);
  else if (i.payMax < i.payMin) throw new ServiceError("Maximum compensation cannot be lower than the minimum");

  const [cat] = await db.select().from(categories).where(eq(categories.id, i.categoryId)).limit(1);
  if (!cat || !cat.active) throw new ServiceError("Choose a valid category");
  if (cat.allowedEngagementTypes?.length && !cat.allowedEngagementTypes.includes(i.engagementType))
    throw new ServiceError(`${cat.name} does not support ${ENGAGEMENT_LABELS[i.engagementType]} engagements`);

  let status: "draft" | "pending_review" | "published" = "draft";
  if (opts.publish) status = cat.requiresApproval || (await getModerationEnabled()) ? "pending_review" : "published";

  return db.transaction(async (tx) => {
    const values = {
      businessId, createdBy: userId, title: i.title, description: i.description, responsibilities: i.responsibilities ?? null,
      engagementType: i.engagementType, categoryId: i.categoryId, arrangement: i.arrangement,
      serviceAreaId: i.serviceAreaId ?? null, locationNote: i.locationNote ?? null, payType: i.payType,
      payMinCents: Math.round(i.payMin * 100), payMaxCents: Math.round(i.payMax * 100),
      estimatedHours: i.estimatedHours ?? null, hoursPerWeek: i.hoursPerWeek ?? null,
      startDate: i.startDate ?? null, endDate: i.endDate ?? null, applicationDeadline: i.applicationDeadline ?? null,
      workersNeeded: i.workersNeeded, experienceLevel: i.experienceLevel,
      recurring: i.engagementType === "recurring", recurrenceNote: i.recurrenceNote ?? null, preferSameWorker: i.preferSameWorker,
      deliverables: i.deliverables ?? null, equipment: i.equipment ?? null, selectionProcess: i.selectionProcess ?? null,
      cancellationTerms: i.cancellationTerms ?? null, qualificationsRequired: i.qualificationsRequired ?? null,
      status, publishedAt: status === "published" ? new Date() : null, updatedAt: new Date(),
    };
    let oppId = opts.id;
    if (oppId) {
      const [existing] = await tx.select().from(opportunities).where(and(eq(opportunities.id, oppId), eq(opportunities.businessId, businessId))).limit(1);
      if (!existing) throw new ServiceError("Opportunity not found", "not_found");
      if (!["draft", "rejected", "paused"].includes(existing.status) && !opts.publish) throw new ServiceError("Only drafts can be saved without publishing");
      await tx.update(opportunities).set({ ...values, publishedAt: values.publishedAt ?? existing.publishedAt }).where(eq(opportunities.id, oppId));
      await tx.delete(opportunitySkills).where(eq(opportunitySkills.opportunityId, oppId));
      await tx.delete(opportunitySchedules).where(eq(opportunitySchedules.opportunityId, oppId));
    } else {
      const [o] = await tx.insert(opportunities).values(values).returning({ id: opportunities.id });
      oppId = o.id;
    }
    if (i.skillIds.length) await tx.insert(opportunitySkills).values(i.skillIds.map((skillId) => ({ opportunityId: oppId!, skillId, mandatory: i.mandatorySkillIds.includes(skillId) })));
    // Screening questions are frozen once anyone has applied (answers reference them).
    const [{ n: appCount }] = await tx.select({ n: sql<number>`count(*)::int` }).from(applications).where(eq(applications.opportunityId, oppId!));
    if (appCount === 0) {
      await tx.delete(opportunityQuestions).where(eq(opportunityQuestions.opportunityId, oppId!));
      if (i.questions.length) await tx.insert(opportunityQuestions).values(i.questions.map((q, n) => ({ opportunityId: oppId!, prompt: q.prompt, required: q.required, sortOrder: n })));
    }
    if (i.schedule.length) await tx.insert(opportunitySchedules).values(i.schedule.map((s) => ({ opportunityId: oppId!, ...s })));
    await audit(userId, opts.publish ? "opportunity.submitted" : "opportunity.draft_saved", "opportunity", oppId, { status }, tx);
    return { id: oppId!, status };
  });
}

export type SearchParams = {
  q?: string; category?: string; arrangement?: string; engagementType?: string; payType?: string;
  minPay?: number; area?: string; skill?: string; experience?: string; recurring?: boolean; weekday?: number;
  sort?: "newest" | "pay" | "relevance"; page?: number; pageSize?: number; ids?: string[]; since?: Date;
};

export async function searchOpportunities(p: SearchParams) {
  const conds: SQL[] = [eq(opportunities.status, "published"), eq(businesses.status, "active")];
  if (p.since) conds.push(sql`${opportunities.publishedAt} > ${p.since.toISOString()}::timestamptz`);
  if (p.ids) conds.push(p.ids.length ? inArray(opportunities.id, p.ids) : sql`false`);
  const q = p.q?.trim();
  if (q) conds.push(sql`${opportunities.search} @@ websearch_to_tsquery('english', ${q})`);
  if (p.category) conds.push(eq(opportunities.categoryId, p.category));
  if (p.arrangement && ["remote", "local", "hybrid"].includes(p.arrangement)) conds.push(eq(opportunities.arrangement, p.arrangement as "remote"));
  if (p.engagementType && p.engagementType in ENGAGEMENT_LABELS) conds.push(eq(opportunities.engagementType, p.engagementType as "micro_task"));
  if (p.payType && p.payType in PAY_LABELS) conds.push(eq(opportunities.payType, p.payType as "hourly"));
  if (p.minPay) conds.push(gte(opportunities.payMaxCents, Math.round(p.minPay * 100)));
  if (p.area) conds.push(eq(opportunities.serviceAreaId, p.area));
  if (p.experience) conds.push(eq(opportunities.experienceLevel, p.experience as "entry"));
  if (p.recurring) conds.push(eq(opportunities.recurring, true));
  if (p.skill) conds.push(sql`exists (select 1 from opportunity_skills os where os.opportunity_id = ${opportunities.id} and os.skill_id = ${p.skill})`);
  if (p.weekday !== undefined) conds.push(sql`exists (select 1 from opportunity_schedules s where s.opportunity_id = ${opportunities.id} and s.weekday = ${p.weekday})`);
  conds.push(sql`(${opportunities.applicationDeadline} is null or ${opportunities.applicationDeadline} >= current_date)`);

  const pageSize = Math.min(p.pageSize ?? 12, 50);
  const page = Math.max(p.page ?? 1, 1);
  const order = p.sort === "pay" ? [desc(opportunities.payMaxCents)]
    : p.sort === "relevance" && q ? [desc(sql`ts_rank(${opportunities.search}, websearch_to_tsquery('english', ${q}))`), desc(opportunities.publishedAt)]
    : [desc(opportunities.featured), desc(opportunities.publishedAt)];

  const where = and(...conds);
  const rows = await db.select({
    o: opportunities, businessName: businesses.name, businessVerified: businesses.verificationStatus, categoryName: categories.name, areaName: serviceAreas.name, areaCity: serviceAreas.city,
  }).from(opportunities)
    .innerJoin(businesses, eq(businesses.id, opportunities.businessId))
    .leftJoin(categories, eq(categories.id, opportunities.categoryId))
    .leftJoin(serviceAreas, eq(serviceAreas.id, opportunities.serviceAreaId))
    .where(where).orderBy(...order).limit(pageSize).offset((page - 1) * pageSize);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(opportunities).innerJoin(businesses, eq(businesses.id, opportunities.businessId)).where(where);

  const ids = rows.map((r) => r.o.id);
  const skillRows = ids.length ? await db.select({ opportunityId: opportunitySkills.opportunityId, name: skills.name, mandatory: opportunitySkills.mandatory })
    .from(opportunitySkills).innerJoin(skills, eq(skills.id, opportunitySkills.skillId)).where(inArray(opportunitySkills.opportunityId, ids)) : [];
  return {
    total: n, page, pageSize, pages: Math.max(Math.ceil(n / pageSize), 1),
    items: rows.map((r) => ({ ...r, skills: skillRows.filter((s) => s.opportunityId === r.o.id) })),
  };
}

export async function getOpportunityDetail(id: string) {
  const [r] = await db.select({
    o: opportunities, business: businesses, categoryName: categories.name, areaName: serviceAreas.name, areaCity: serviceAreas.city,
  }).from(opportunities).innerJoin(businesses, eq(businesses.id, opportunities.businessId))
    .leftJoin(categories, eq(categories.id, opportunities.categoryId)).leftJoin(serviceAreas, eq(serviceAreas.id, opportunities.serviceAreaId))
    .where(eq(opportunities.id, id)).limit(1);
  if (!r) return null;
  const [sk, sched, questions] = await Promise.all([
    db.select({ skillId: skills.id, name: skills.name, mandatory: opportunitySkills.mandatory }).from(opportunitySkills).innerJoin(skills, eq(skills.id, opportunitySkills.skillId)).where(eq(opportunitySkills.opportunityId, id)),
    db.select().from(opportunitySchedules).where(eq(opportunitySchedules.opportunityId, id)).orderBy(asc(opportunitySchedules.weekday), asc(opportunitySchedules.startMinute)),
    db.select().from(opportunityQuestions).where(eq(opportunityQuestions.opportunityId, id)).orderBy(asc(opportunityQuestions.sortOrder)),
  ]);
  return { ...r, skills: sk, schedule: sched, questions };
}

export async function setOpportunityStatus(userId: string, businessId: string, id: string, status: "paused" | "closed" | "published") {
  await assertBusinessPermission(userId, businessId, "opportunity.write");
  const [o] = await db.select().from(opportunities).where(and(eq(opportunities.id, id), eq(opportunities.businessId, businessId))).limit(1);
  if (!o) throw new ServiceError("Opportunity not found", "not_found");
  const allowed: Record<string, string[]> = { published: ["paused", "closed"], paused: ["published", "closed"], filled: ["closed"] };
  if (!allowed[o.status]?.includes(status)) throw new ServiceError(`Cannot change a ${o.status} opportunity to ${status}`);
  await db.update(opportunities).set({ status, updatedAt: new Date() }).where(eq(opportunities.id, id));
  await audit(userId, `opportunity.${status}`, "opportunity", id);
}

export const formatMoney = (cents: number) => "$" + (cents / 100).toLocaleString("en-CA", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
export function formatPay(o: { payType: string; payMinCents: number; payMaxCents: number }) {
  const range = o.payMinCents === o.payMaxCents ? formatMoney(o.payMinCents) : `${formatMoney(o.payMinCents)}–${formatMoney(o.payMaxCents)}`;
  return range + (PAY_SUFFIX[o.payType] ?? "");
}

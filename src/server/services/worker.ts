import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import {
  categories, serviceAreas, skills, workerAvailability, workerCertifications, workerEducation, workerExperience,
  workerProfiles, workerSkills, workerUnavailability, verifications,
} from "../db/schema";
import { audit } from "../audit";
import { ServiceError } from "./identity";

export const aboutSchema = z.object({
  headline: z.string().trim().min(5, "Add a short headline").max(120),
  summary: z.string().trim().min(30, "Write at least a couple of sentences about yourself").max(2000),
  languages: z.array(z.string().trim().min(2).max(40)).max(12).default([]),
  portfolioLinks: z.array(z.string().trim().url("Portfolio links must be valid URLs (https://…)").max(300)).max(10).default([]),
  experienceLevel: z.enum(["entry", "intermediate", "experienced", "expert"]),
  skillIds: z.array(z.string().uuid()).min(1, "Choose at least one skill").max(30),
});
export const experienceSchema = z.object({
  title: z.string().trim().min(2).max(120), organisation: z.string().trim().min(2).max(120),
  startYear: z.coerce.number().int().min(1950).max(2100), endYear: z.coerce.number().int().min(1950).max(2100).optional().or(z.literal("")).transform((v) => (v === "" ? undefined : v)),
  description: z.string().trim().max(1000).optional(),
});
export const educationSchema = z.object({ institution: z.string().trim().min(2).max(160), credential: z.string().trim().min(2).max(160), year: z.coerce.number().int().min(1950).max(2100).optional().or(z.literal("")).transform((v) => (v === "" ? undefined : v)) });
export const certificationSchema = z.object({ name: z.string().trim().min(2).max(160), issuer: z.string().trim().max(160).optional(), year: z.coerce.number().int().min(1950).max(2100).optional().or(z.literal("")).transform((v) => (v === "" ? undefined : v)) });

export const preferencesSchema = z.object({
  arrangements: z.array(z.enum(["remote", "local", "hybrid"])).min(1, "Choose at least one"),
  engagementTypes: z.array(z.enum(["micro_task", "fixed_project", "flexible_shift", "recurring", "specialist_consultation", "local_service"])).default([]),
  categoryIds: z.array(z.string().uuid()).max(20).default([]),
  serviceAreaId: z.string().uuid().optional().or(z.literal("")).transform((v) => v || undefined),
  travelRadiusKm: z.coerce.number().int().min(1).max(200).default(15),
  publicProfile: z.boolean().default(true),
});
export const compensationSchema = z.object({
  preferredHourly: z.coerce.number().positive().max(1000).optional().or(z.literal("")).transform((v) => (v === "" ? undefined : v)),
  minHourly: z.coerce.number().positive().max(1000).optional().or(z.literal("")).transform((v) => (v === "" ? undefined : v)),
  minHourlyIsHard: z.boolean().default(false),
  preferredFixed: z.coerce.number().positive().max(100000).optional().or(z.literal("")).transform((v) => (v === "" ? undefined : v)),
  willingToNegotiate: z.boolean().default(true),
}).refine((v) => !v.minHourly || !v.preferredHourly || v.preferredHourly >= v.minHourly, { message: "Preferred rate cannot be lower than your minimum" });

export const availabilitySchema = z.object({
  windows: z.array(z.object({ weekday: z.number().int().min(0).max(6), startMinute: z.number().int().min(0).max(1439), endMinute: z.number().int().min(1).max(1440) })
    .refine((w) => w.endMinute > w.startMinute, "End time must be after start time")).max(42),
  maxHoursPerWeek: z.coerce.number().int().min(1).max(80).optional().or(z.literal("")).transform((v) => (v === "" ? undefined : v)),
  minAssignmentDays: z.coerce.number().int().min(1).max(3650).optional().or(z.literal("")).transform((v) => (v === "" ? undefined : v)),
  maxAssignmentDays: z.coerce.number().int().min(1).max(3650).optional().or(z.literal("")).transform((v) => (v === "" ? undefined : v)),
  availabilityPaused: z.boolean().default(false),
  timezone: z.string().min(3).max(60).default("America/Edmonton"),
}).refine((v) => !v.minAssignmentDays || !v.maxAssignmentDays || v.maxAssignmentDays >= v.minAssignmentDays, { message: "Maximum duration cannot be below the minimum" });

/** Merge overlapping/adjacent windows per weekday so stored availability is canonical. */
export function normaliseWindows(ws: { weekday: number; startMinute: number; endMinute: number }[]) {
  const out: typeof ws = [];
  for (const wd of [0, 1, 2, 3, 4, 5, 6]) {
    const day = ws.filter((w) => w.weekday === wd).sort((a, b) => a.startMinute - b.startMinute);
    for (const w of day) {
      const last = out[out.length - 1];
      if (last && last.weekday === wd && w.startMinute <= last.endMinute) last.endMinute = Math.max(last.endMinute, w.endMinute);
      else out.push({ ...w });
    }
  }
  return out;
}

export async function saveAbout(userId: string, raw: unknown) {
  const i = aboutSchema.parse(raw);
  const valid = await db.select({ id: skills.id }).from(skills).where(eq(skills.active, true));
  const ok = new Set(valid.map((s) => s.id));
  if (i.skillIds.some((s) => !ok.has(s))) throw new ServiceError("One or more skills are not available");
  await db.transaction(async (tx) => {
    await tx.update(workerProfiles).set({ headline: i.headline, summary: i.summary, languages: i.languages, portfolioLinks: i.portfolioLinks, experienceLevel: i.experienceLevel, updatedAt: new Date() }).where(eq(workerProfiles.userId, userId));
    await tx.delete(workerSkills).where(eq(workerSkills.userId, userId));
    await tx.insert(workerSkills).values(i.skillIds.map((skillId) => ({ userId, skillId })));
  });
}

export async function savePreferences(userId: string, raw: unknown) {
  const i = preferencesSchema.parse(raw);
  if (i.categoryIds.length) {
    const cats = await db.select({ id: categories.id }).from(categories).where(eq(categories.active, true));
    const ok = new Set(cats.map((c) => c.id));
    if (i.categoryIds.some((c) => !ok.has(c))) throw new ServiceError("Invalid category");
  }
  if (i.serviceAreaId) {
    const [a] = await db.select().from(serviceAreas).where(and(eq(serviceAreas.id, i.serviceAreaId), eq(serviceAreas.active, true))).limit(1);
    if (!a) throw new ServiceError("Invalid service area");
  }
  if ((i.arrangements.includes("local") || i.arrangements.includes("hybrid")) && !i.serviceAreaId) throw new ServiceError("Choose your service area to receive local work");
  await db.update(workerProfiles).set({ ...i, serviceAreaId: i.serviceAreaId ?? null, updatedAt: new Date() }).where(eq(workerProfiles.userId, userId));
}

export async function saveCompensation(userId: string, raw: unknown) {
  const i = compensationSchema.parse(raw);
  await db.update(workerProfiles).set({
    preferredHourlyCents: i.preferredHourly ? Math.round(i.preferredHourly * 100) : null,
    minHourlyCents: i.minHourly ? Math.round(i.minHourly * 100) : null,
    minHourlyIsHard: i.minHourlyIsHard && !!i.minHourly,
    preferredFixedCents: i.preferredFixed ? Math.round(i.preferredFixed * 100) : null,
    willingToNegotiate: i.willingToNegotiate, updatedAt: new Date(),
  }).where(eq(workerProfiles.userId, userId));
}

export async function saveAvailability(userId: string, raw: unknown) {
  const i = availabilitySchema.parse(raw);
  const windows = normaliseWindows(i.windows);
  await db.transaction(async (tx) => {
    await tx.delete(workerAvailability).where(eq(workerAvailability.userId, userId));
    if (windows.length) await tx.insert(workerAvailability).values(windows.map((w) => ({ userId, ...w })));
    await tx.update(workerProfiles).set({
      maxHoursPerWeek: i.maxHoursPerWeek ?? null, minAssignmentDays: i.minAssignmentDays ?? null, maxAssignmentDays: i.maxAssignmentDays ?? null,
      availabilityPaused: i.availabilityPaused, timezone: i.timezone, updatedAt: new Date(),
    }).where(eq(workerProfiles.userId, userId));
  });
}

export async function addUnavailability(userId: string, start: string, end: string, reason?: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) throw new ServiceError("Enter valid dates");
  if (end < start) throw new ServiceError("End date cannot be before start date");
  await db.insert(workerUnavailability).values({ userId, startDate: start, endDate: end, reason: reason?.slice(0, 200) ?? null });
}
export async function removeUnavailability(userId: string, id: string) {
  await db.delete(workerUnavailability).where(and(eq(workerUnavailability.id, id), eq(workerUnavailability.userId, userId)));
}

export async function addExperience(userId: string, raw: unknown) {
  const i = experienceSchema.parse(raw);
  if (i.endYear && i.endYear < i.startYear) throw new ServiceError("End year cannot be before start year");
  await db.insert(workerExperience).values({ userId, ...i, endYear: i.endYear ?? null, description: i.description ?? null });
}
export async function addEducation(userId: string, raw: unknown) { const i = educationSchema.parse(raw); await db.insert(workerEducation).values({ userId, ...i, year: i.year ?? null }); }
export async function addCertification(userId: string, raw: unknown) {
  const i = certificationSchema.parse(raw);
  // Self-declared: verificationStatus stays "not_started" until a verification officer reviews evidence.
  await db.insert(workerCertifications).values({ userId, name: i.name, issuer: i.issuer ?? null, year: i.year ?? null });
}
export async function removeOwnRow(userId: string, kind: "experience" | "education" | "certification", id: string) {
  const t = kind === "experience" ? workerExperience : kind === "education" ? workerEducation : workerCertifications;
  await db.delete(t).where(and(eq(t.id, id), eq(t.userId, userId)));
}

export async function completeOnboarding(userId: string) {
  const c = await profileCompletion(userId);
  const missing = c.items.filter((i) => i.required && !i.done);
  if (missing.length) throw new ServiceError("Still needed: " + missing.map((m) => m.label).join(", "));
  await db.update(workerProfiles).set({ onboardingCompletedAt: new Date(), onboardingStep: 7 }).where(eq(workerProfiles.userId, userId));
  await audit(userId, "worker.onboarding_completed", "user", userId);
}

export async function getWorkerBundle(userId: string) {
  const [[profile], sk, av, un, exp, edu, cert, ver] = await Promise.all([
    db.select().from(workerProfiles).where(eq(workerProfiles.userId, userId)).limit(1),
    db.select({ id: skills.id, name: skills.name }).from(workerSkills).innerJoin(skills, eq(skills.id, workerSkills.skillId)).where(eq(workerSkills.userId, userId)),
    db.select().from(workerAvailability).where(eq(workerAvailability.userId, userId)),
    db.select().from(workerUnavailability).where(eq(workerUnavailability.userId, userId)),
    db.select().from(workerExperience).where(eq(workerExperience.userId, userId)),
    db.select().from(workerEducation).where(eq(workerEducation.userId, userId)),
    db.select().from(workerCertifications).where(eq(workerCertifications.userId, userId)),
    db.select().from(verifications).where(eq(verifications.userId, userId)),
  ]);
  return { profile, skills: sk, availability: av, unavailability: un, experience: exp, education: edu, certifications: cert, verifications: ver };
}

export async function profileCompletion(userId: string) {
  const b = await getWorkerBundle(userId);
  const p = b.profile;
  const items = [
    { label: "Headline and summary", done: !!(p?.headline && p?.summary), required: true },
    { label: "At least one skill", done: b.skills.length > 0, required: true },
    { label: "Work preferences", done: (p?.arrangements.length ?? 0) > 0, required: true },
    { label: "Weekly availability", done: b.availability.length > 0, required: true },
    { label: "Compensation preferences", done: !!(p?.preferredHourlyCents || p?.minHourlyCents || p?.preferredFixedCents), required: false },
    { label: "Work experience", done: b.experience.length > 0, required: false },
    { label: "Education or certifications", done: b.education.length + b.certifications.length > 0, required: false },
  ];
  const pct = Math.round((items.filter((i) => i.done).length / items.length) * 100);
  return { items, pct };
}

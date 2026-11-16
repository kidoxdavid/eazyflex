"use server";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { savedOpportunities } from "@/server/db/schema";
import { requireUser } from "@/server/auth/session";
import { run, str, strs, bool, parseWindows, ret, failTo } from "./util";
import * as W from "@/server/services/worker";
import { applyToOpportunity, workerSetApplicationStatus } from "@/server/services/applications";

export async function saveAboutAction(f: FormData) {
  const u = await requireUser("worker");
  await run(async () => { await W.saveAbout(u.id, {
    headline: str(f, "headline"), summary: str(f, "summary"), experienceLevel: str(f, "experienceLevel"), skillIds: strs(f, "skillIds"),
    languages: (str(f, "languages") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    portfolioLinks: (str(f, "portfolioLinks") ?? "").split(/\s+/).map((s) => s.trim()).filter(Boolean),
  }); return ret(f, "/worker/profile"); }, failTo(f, "/worker/profile"), "Profile saved");
}
export async function savePreferencesAction(f: FormData) {
  const u = await requireUser("worker");
  await run(async () => { await W.savePreferences(u.id, {
    arrangements: strs(f, "arrangements"), engagementTypes: strs(f, "engagementTypes"), categoryIds: strs(f, "categoryIds"),
    serviceAreaId: str(f, "serviceAreaId") ?? "", travelRadiusKm: str(f, "travelRadiusKm") ?? 15, publicProfile: bool(f, "publicProfile"),
  }); return ret(f, "/worker/profile"); }, failTo(f, "/worker/profile"), "Work preferences saved");
}
export async function saveCompensationAction(f: FormData) {
  const u = await requireUser("worker");
  await run(async () => { await W.saveCompensation(u.id, {
    preferredHourly: str(f, "preferredHourly") ?? "", minHourly: str(f, "minHourly") ?? "", minHourlyIsHard: bool(f, "minHourlyIsHard"),
    preferredFixed: str(f, "preferredFixed") ?? "", willingToNegotiate: bool(f, "willingToNegotiate"),
  }); return ret(f, "/worker/profile"); }, failTo(f, "/worker/profile"), "Compensation preferences saved");
}
export async function saveAvailabilityAction(f: FormData) {
  const u = await requireUser("worker");
  await run(async () => { await W.saveAvailability(u.id, {
    windows: parseWindows(f), maxHoursPerWeek: str(f, "maxHoursPerWeek") ?? "", minAssignmentDays: str(f, "minAssignmentDays") ?? "",
    maxAssignmentDays: str(f, "maxAssignmentDays") ?? "", availabilityPaused: bool(f, "availabilityPaused"), timezone: str(f, "timezone") ?? "America/Edmonton",
  }); return ret(f, "/worker/availability"); }, failTo(f, "/worker/availability"), "Availability saved");
}
export async function addUnavailabilityAction(f: FormData) {
  const u = await requireUser("worker");
  await run(() => W.addUnavailability(u.id, str(f, "start") ?? "", str(f, "end") ?? "", str(f, "reason")), "/worker/availability", "Unavailable dates added");
}
export async function removeUnavailabilityAction(f: FormData) {
  const u = await requireUser("worker");
  await run(() => W.removeUnavailability(u.id, str(f, "id") ?? ""), "/worker/availability", "Removed");
}
export async function addExperienceAction(f: FormData) {
  const u = await requireUser("worker");
  await run(() => W.addExperience(u.id, { title: str(f, "title"), organisation: str(f, "organisation"), startYear: str(f, "startYear"), endYear: str(f, "endYear") ?? "", description: str(f, "description") }), "/worker/profile", "Experience added");
}
export async function addEducationAction(f: FormData) {
  const u = await requireUser("worker");
  await run(() => W.addEducation(u.id, { institution: str(f, "institution"), credential: str(f, "credential"), year: str(f, "year") ?? "" }), "/worker/profile", "Education added");
}
export async function addCertificationAction(f: FormData) {
  const u = await requireUser("worker");
  await run(() => W.addCertification(u.id, { name: str(f, "name"), issuer: str(f, "issuer"), year: str(f, "year") ?? "" }), "/worker/profile", "Certification added (self-declared until reviewed)");
}
export async function removeRowAction(f: FormData) {
  const u = await requireUser("worker");
  const kind = str(f, "kind") as "experience" | "education" | "certification";
  await run(() => W.removeOwnRow(u.id, kind, str(f, "id") ?? ""), "/worker/profile", "Removed");
}
export async function completeOnboardingAction() {
  const u = await requireUser("worker");
  await run(async () => { await W.completeOnboarding(u.id); return "/worker?ok=" + encodeURIComponent("Your profile is live. Here are opportunities picked for you."); }, "/worker/onboarding");
}

export async function toggleSaveAction(f: FormData) {
  const u = await requireUser("worker");
  const id = str(f, "opportunityId") ?? "", back = str(f, "back") ?? "/worker/saved";
  await run(async () => {
    const [ex] = await db.select().from(savedOpportunities).where(and(eq(savedOpportunities.userId, u.id), eq(savedOpportunities.opportunityId, id)));
    if (ex) await db.delete(savedOpportunities).where(and(eq(savedOpportunities.userId, u.id), eq(savedOpportunities.opportunityId, id)));
    else await db.insert(savedOpportunities).values({ userId: u.id, opportunityId: id });
  }, back.startsWith("/") ? back : "/worker/saved", "Saved list updated");
}

export async function applyAction(f: FormData) {
  const u = await requireUser("worker");
  const id = str(f, "opportunityId") ?? "";
  await run(async () => {
    await applyToOpportunity(u.id, { opportunityId: id, proposal: str(f, "proposal"), proposedRate: str(f, "proposedRate") ?? "", availabilityNote: str(f, "availabilityNote") });
    return "/worker/applications?ok=" + encodeURIComponent("Application submitted");
  }, `/opportunities/${id}`);
}
export async function workerApplicationStatusAction(f: FormData) {
  const u = await requireUser("worker");
  const to = str(f, "to") as "withdrawn" | "accepted" | "declined";
  await run(() => workerSetApplicationStatus(u.id, str(f, "applicationId") ?? "", to), "/worker/applications", to === "accepted" ? "Offer accepted" : to === "declined" ? "Offer declined" : "Application withdrawn");
}

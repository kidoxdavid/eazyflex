import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { savedSearches, users } from "../db/schema";
import { notify } from "../notify";
import { audit } from "../audit";
import { ServiceError } from "./identity";
import { searchOpportunities, type SearchParams } from "./opportunities";

const KEYS = ["q", "category", "arrangement", "engagementType", "payType", "minPay", "area", "skill", "experience", "recurring", "weekday"] as const;
export const MAX_SEARCHES = 10;

/** Only known filter keys with short string values are stored — nothing arbitrary reaches the database or later queries. */
export function cleanParams(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of KEYS) { const v = raw[k]; if (typeof v === "string" && v.trim() && v.length <= 100) out[k] = v.trim(); }
  return out;
}
export function toSearchParams(p: Record<string, string>): SearchParams {
  return { q: p.q, category: p.category, arrangement: p.arrangement, engagementType: p.engagementType, payType: p.payType, minPay: p.minPay ? Number(p.minPay) : undefined,
    area: p.area, skill: p.skill, experience: p.experience, recurring: p.recurring === "1", weekday: p.weekday ? Number(p.weekday) : undefined };
}
const uuidish = /^[0-9a-f-]{36}$/i;

export async function saveSearch(userId: string, nameRaw: string, raw: Record<string, unknown>, alerts: boolean) {
  const name = z.string().trim().min(2, "Give the search a name").max(80).parse(nameRaw);
  const params = cleanParams(raw);
  if (!Object.keys(params).length) throw new ServiceError("Apply at least one filter or keyword before saving a search");
  for (const k of ["category", "area", "skill"]) if (params[k] && !uuidish.test(params[k])) throw new ServiceError("Invalid filter");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(savedSearches).where(eq(savedSearches.userId, userId));
  if (n >= MAX_SEARCHES) throw new ServiceError(`You can save up to ${MAX_SEARCHES} searches. Delete one first.`);
  await db.insert(savedSearches).values({ userId, name, params, alertsEnabled: alerts });
}
export const listSearches = (userId: string) => db.select().from(savedSearches).where(eq(savedSearches.userId, userId)).orderBy(desc(savedSearches.createdAt));
export async function deleteSearch(userId: string, id: string) { await db.delete(savedSearches).where(and(eq(savedSearches.id, id), eq(savedSearches.userId, userId))); }
export async function setAlerts(userId: string, id: string, on: boolean) {
  // Turning alerts on resets the baseline so the user is not flooded with everything published before now.
  await db.update(savedSearches).set({ alertsEnabled: on, ...(on ? { lastAlertedAt: new Date() } : {}) }).where(and(eq(savedSearches.id, id), eq(savedSearches.userId, userId)));
}

/** Digest job: at most ONE notification per saved search per run, listing up to 3 new opportunities. Run on a schedule (`npm run alerts:send`). */
export async function runSavedSearchAlerts(now = new Date()) {
  const rows = await db.select({ s: savedSearches, status: users.status, verified: users.emailVerifiedAt }).from(savedSearches).innerJoin(users, eq(users.id, savedSearches.userId)).where(eq(savedSearches.alertsEnabled, true));
  let notified = 0;
  for (const { s, status } of rows) {
    if (status !== "active") continue;
    const res = await searchOpportunities({ ...toSearchParams(s.params as Record<string, string>), since: s.lastAlertedAt, sort: "newest", pageSize: 3 });
    await db.update(savedSearches).set({ lastAlertedAt: now }).where(eq(savedSearches.id, s.id));
    if (res.total === 0) continue;
    const titles = res.items.map((i) => i.o.title).join("; ");
    await notify(s.userId, "alert", `${res.total} new match${res.total === 1 ? "" : "es"} for “${s.name}”`, `${titles}${res.total > res.items.length ? ` and ${res.total - res.items.length} more` : ""}.`, `/opportunities?${new URLSearchParams(s.params as Record<string, string>)}`);
    await audit(null, "alerts.sent", "saved_search", s.id, { count: res.total });
    notified++;
  }
  return { searches: rows.length, notified };
}

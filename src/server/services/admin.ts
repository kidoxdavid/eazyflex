import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import {
  applications, auditLogs, businesses, categories, matchingRules, opportunities, sessions, skills, users, verifications, adminNotes,
} from "../db/schema";
import { audit } from "../audit";
import { can, type AdminRole, type Permission } from "../rbac";
import { ServiceError } from "./identity";

export type Actor = { id: string; kind: string; adminRole: AdminRole | null };

/** Service-layer permission check: authorisation never depends on the UI or route guard alone. */
export function assertCan(actor: Actor, perm: Permission) {
  if (actor.kind !== "admin" || !can(actor.adminRole, perm)) throw new ServiceError(`Forbidden: ${perm} required`, "forbidden");
}

export async function dashboardStats(actor: Actor) {
  assertCan(actor, "dashboard.view");
  const one = async (q: ReturnType<typeof sql>) => Number(((await db.execute(q)).rows[0] as { n: number }).n);
  const [assignActive, assignDone, workers, activeWorkers, bizTotal, bizVerified, opps, oppsActive, apps, pendingOpps, pendingVerif, suspended, demoUsers] = await Promise.all([
    one(sql`select count(*)::int n from assignments where status in ('confirmed','in_progress','submitted','changes_requested')`),
    one(sql`select count(*)::int n from assignments where status='completed'`),
    one(sql`select count(*)::int n from users where kind='worker' and status <> 'deleted'`),
    one(sql`select count(*)::int n from users where kind='worker' and status='active' and last_login_at > now() - interval '30 days'`),
    one(sql`select count(*)::int n from businesses`),
    one(sql`select count(*)::int n from businesses where verification_status='verified'`),
    one(sql`select count(*)::int n from opportunities where status <> 'draft'`),
    one(sql`select count(*)::int n from opportunities where status='published'`),
    one(sql`select count(*)::int n from applications`),
    one(sql`select count(*)::int n from opportunities where status='pending_review'`),
    one(sql`select count(*)::int n from verifications where status in ('submitted','requires_review','pending') and type <> 'email'`),
    one(sql`select count(*)::int n from users where status in ('suspended','restricted')`),
    one(sql`select count(*)::int n from users where is_demo`),
  ]);
  return { assignActive, assignDone, workers, activeWorkers, bizTotal, bizVerified, opps, oppsActive, apps, pendingOpps, pendingVerif, suspended, demoUsers };
}

export async function listUsers(actor: Actor, q?: string, kind?: string) {
  assertCan(actor, "users.view");
  const conds = [];
  if (q) conds.push(or(ilike(users.email, `%${q}%`), ilike(users.fullName, `%${q}%`)));
  if (kind && ["worker", "business", "admin"].includes(kind)) conds.push(eq(users.kind, kind as "worker"));
  // Deliberately excludes password hash, documents and messages.
  return db.select({ id: users.id, email: users.email, fullName: users.fullName, kind: users.kind, status: users.status, adminRole: users.adminRole, emailVerifiedAt: users.emailVerifiedAt, isDemo: users.isDemo, createdAt: users.createdAt, lastLoginAt: users.lastLoginAt })
    .from(users).where(conds.length ? and(...conds) : undefined).orderBy(desc(users.createdAt)).limit(100);
}

export async function setUserStatus(actor: Actor, userId: string, status: "active" | "suspended" | "restricted", reason: string) {
  assertCan(actor, "users.suspend");
  if (userId === actor.id) throw new ServiceError("You cannot change your own account status");
  if (!reason.trim()) throw new ServiceError("A reason is required");
  const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!target) throw new ServiceError("User not found", "not_found");
  if (target.kind === "admin" && actor.adminRole !== "super_admin") throw new ServiceError("Only a super administrator can change an administrator account", "forbidden");
  await db.transaction(async (tx) => {
    await tx.update(users).set({ status, updatedAt: new Date() }).where(eq(users.id, userId));
    if (status !== "active") await tx.delete(sessions).where(eq(sessions.userId, userId)); // revoke sessions immediately
    await audit(actor.id, `user.${status}`, "user", userId, { reason, previous: target.status }, tx);
    await tx.insert(adminNotes).values({ userId, authorId: actor.id, note: `Status → ${status}: ${reason}` });
  });
}

export async function moderateOpportunity(actor: Actor, id: string, decision: "approve" | "reject" | "pause" | "close" | "feature" | "unfeature", note?: string) {
  assertCan(actor, "opportunities.moderate");
  const [o] = await db.select().from(opportunities).where(eq(opportunities.id, id)).limit(1);
  if (!o) throw new ServiceError("Opportunity not found", "not_found");
  if (decision === "reject" && !note?.trim()) throw new ServiceError("Explain why the opportunity was rejected so the business can fix it");
  const patch: Partial<typeof opportunities.$inferInsert> = { updatedAt: new Date(), moderationNote: note ?? o.moderationNote };
  if (decision === "approve") { if (o.status !== "pending_review") throw new ServiceError("Only opportunities pending review can be approved"); Object.assign(patch, { status: "published", publishedAt: new Date() }); }
  else if (decision === "reject") { if (o.status !== "pending_review") throw new ServiceError("Only opportunities pending review can be rejected"); patch.status = "rejected"; }
  else if (decision === "pause") patch.status = "paused";
  else if (decision === "close") patch.status = "closed";
  else patch.featured = decision === "feature";
  await db.transaction(async (tx) => {
    await tx.update(opportunities).set(patch).where(eq(opportunities.id, id));
    await audit(actor.id, `opportunity.${decision}`, "opportunity", id, { note }, tx);
  });
}

export async function decideVerification(actor: Actor, verificationId: string, decision: "verified" | "rejected" | "requires_review", notes?: string) {
  assertCan(actor, "verification.decide");
  const [v] = await db.select().from(verifications).where(eq(verifications.id, verificationId)).limit(1);
  if (!v) throw new ServiceError("Verification not found", "not_found");
  if (v.type === "email") throw new ServiceError("Email verification is automatic and cannot be set manually");
  await db.transaction(async (tx) => {
    await tx.update(verifications).set({ status: decision, notes: notes ?? null, decidedBy: actor.id, decidedAt: new Date(), provider: v.provider ?? "manual_review", updatedAt: new Date() }).where(eq(verifications.id, verificationId));
    if (v.type === "business" && v.businessId) await tx.update(businesses).set({ verificationStatus: decision, updatedAt: new Date() }).where(eq(businesses.id, v.businessId));
    await audit(actor.id, `verification.${decision}`, "verification", verificationId, { type: v.type, notes }, tx);
  });
}

const rulesSchema = z.object({
  weights: z.object({ skills: z.number().min(0).max(100), availability: z.number().min(0).max(100), location: z.number().min(0).max(100), arrangement: z.number().min(0).max(100), compensation: z.number().min(0).max(100), experience: z.number().min(0).max(100), duration: z.number().min(0).max(100), preferences: z.number().min(0).max(100) })
    .refine((w) => Object.values(w).reduce((a, b) => a + b, 0) > 0, "At least one weight must be above zero"),
  thresholds: z.object({ recommend: z.number().min(0).max(100), strong: z.number().min(0).max(100) }).refine((t) => t.strong >= t.recommend, "Strong threshold must be ≥ recommend threshold"),
  mandatory: z.array(z.enum(["skills", "availability", "location", "hardMinRate"])),
  note: z.string().max(300).optional(),
});

/** Matching configuration is versioned: every change creates a new immutable version and activates it. */
export async function publishMatchingRules(actor: Actor, raw: unknown) {
  assertCan(actor, "matching.configure");
  const i = rulesSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [{ v }] = await tx.select({ v: sql<number>`coalesce(max(${matchingRules.version}), 0)::int` }).from(matchingRules);
    await tx.update(matchingRules).set({ active: false }).where(eq(matchingRules.active, true));
    const [row] = await tx.insert(matchingRules).values({ version: v + 1, weights: i.weights, thresholds: { ...i.thresholds, mandatory: i.mandatory }, active: true, createdBy: actor.id, note: i.note ?? null }).returning();
    await audit(actor.id, "matching.rules_published", "matching_rules", row.id, { version: row.version, weights: i.weights, thresholds: i.thresholds, mandatory: i.mandatory }, tx);
    return row;
  });
}

const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
export async function upsertCategory(actor: Actor, input: { id?: string; name: string; description?: string; requiresApproval?: boolean; parentId?: string; active?: boolean }) {
  assertCan(actor, "catalog.manage");
  if (input.name.trim().length < 2) throw new ServiceError("Name is required");
  const vals = { name: input.name.trim(), description: input.description ?? null, requiresApproval: !!input.requiresApproval, parentId: input.parentId || null, active: input.active ?? true };
  await db.transaction(async (tx) => {
    if (input.id) await tx.update(categories).set(vals).where(eq(categories.id, input.id));
    else await tx.insert(categories).values({ ...vals, slug: slug(input.name) });
    await audit(actor.id, input.id ? "category.updated" : "category.created", "category", input.id ?? slug(input.name), vals, tx);
  });
}
export async function upsertSkill(actor: Actor, input: { name: string; categoryId?: string }) {
  assertCan(actor, "catalog.manage");
  if (input.name.trim().length < 2) throw new ServiceError("Name is required");
  await db.transaction(async (tx) => {
    await tx.insert(skills).values({ name: input.name.trim(), slug: slug(input.name), categoryId: input.categoryId || null }).onConflictDoNothing();
    await audit(actor.id, "skill.created", "skill", slug(input.name), undefined, tx);
  });
}

export async function listAudit(actor: Actor, limit = 100) {
  assertCan(actor, "audit.view");
  return db.select({ a: auditLogs, actorEmail: users.email }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorId)).orderBy(desc(auditLogs.createdAt)).limit(limit);
}

export async function applicationsCount() { return (await db.select({ n: sql<number>`count(*)::int` }).from(applications))[0].n; }

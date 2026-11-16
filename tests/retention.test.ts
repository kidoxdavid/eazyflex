import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLogs, authTokens, deletionLedger, emailOutbox, notifications, rateLimits, sessions, users } from "@/server/db/schema";
import { RETENTION, runRetention } from "@/server/services/retention";
import { anonymiseUser, deleteAccount } from "@/server/services/account";
import { closeDb, freshDb, makeUser } from "./helpers";

beforeAll(freshDb);
afterAll(closeDb);
const daysAgo = (d: number) => new Date(Date.now() - d * 86400_000);

describe("retention job", () => {
  it("purges only what is past its retention period and leaves audit logs and recent data alone", async () => {
    const u = await makeUser("worker");
    await db.insert(sessions).values([{ userId: u.id, tokenHash: "old".padEnd(64, "a"), expiresAt: daysAgo(2) }, { userId: u.id, tokenHash: "new".padEnd(64, "b"), expiresAt: new Date(Date.now() + 86400_000) }]);
    await db.insert(authTokens).values([
      { userId: u.id, purpose: "password_reset", tokenHash: "t1".padEnd(64, "c"), expiresAt: daysAgo(30) },                       // expired long ago → purge
      { userId: u.id, purpose: "password_reset", tokenHash: "t2".padEnd(64, "d"), expiresAt: daysAgo(30), usedAt: daysAgo(30) }, // used long ago → purge
      { userId: u.id, purpose: "email_verification", tokenHash: "t3".padEnd(64, "e"), expiresAt: new Date(Date.now() + 86400_000) }, // still valid → keep
      { userId: u.id, purpose: "password_reset", tokenHash: "t4".padEnd(64, "f"), expiresAt: daysAgo(1) },                         // expired yesterday → keep for now
    ]);
    await db.insert(rateLimits).values([{ key: "old-key", count: 3, windowStart: daysAgo(3) }, { key: "fresh-key", count: 1, windowStart: new Date() }]);
    await db.insert(emailOutbox).values([
      { toEmail: "a@example.test", template: "t", subject: "s", body: "b", status: "sent", createdAt: daysAgo(120) },   // purge
      { toEmail: "b@example.test", template: "t", subject: "s", body: "b", status: "sent", createdAt: daysAgo(10) },    // keep
      { toEmail: "c@example.test", template: "t", subject: "s", body: "b", status: "queued", createdAt: daysAgo(45) },  // stuck → purge
      { toEmail: "d@example.test", template: "t", subject: "s", body: "b", status: "queued", createdAt: daysAgo(2) },   // keep
    ]);
    await db.insert(notifications).values([
      { userId: u.id, type: "x", title: "old read", readAt: daysAgo(200), createdAt: daysAgo(200) },       // purge
      { userId: u.id, type: "x", title: "recent read", readAt: daysAgo(5), createdAt: daysAgo(5) },          // keep
      { userId: u.id, type: "x", title: "old unread", createdAt: daysAgo(100) },                              // keep (unread < 365d)
      { userId: u.id, type: "x", title: "ancient unread", createdAt: daysAgo(400) },                          // purge
    ]);
    const auditBefore = (await db.select().from(auditLogs)).length;
    const r = await runRetention();
    expect(r).toMatchObject({ authTokens: 2, emailDelivered: 1, emailStuck: 1, notificationsRead: 1, notificationsUnread: 1 }); expect(r.sessions).toBeGreaterThanOrEqual(1); expect(r.rateLimits).toBeGreaterThanOrEqual(1);
    const tok = (await db.select().from(authTokens).where(eq(authTokens.userId, u.id))).map((t) => t.tokenHash.slice(0, 2)).sort(); expect(tok.filter((t) => ["t3", "t4"].includes(t)).sort()).toEqual(["t3", "t4"]); expect(tok).not.toContain("t1");
    expect((await db.select().from(sessions).where(eq(sessions.userId, u.id))).map((s) => s.tokenHash.slice(0, 3))).toEqual(["new"]);
    expect((await db.select().from(notifications).where(eq(notifications.userId, u.id))).map((n) => n.title).sort()).toEqual(["old unread", "recent read"]);
    expect((await db.select().from(rateLimits)).map((x) => x.key)).toContain("fresh-key"); expect((await db.select().from(rateLimits)).map((x) => x.key)).not.toContain("old-key");
    expect((await db.select().from(auditLogs)).length).toBeGreaterThanOrEqual(auditBefore); // append-only: never purged here
  });
  it("is idempotent and documents its periods", async () => {
    const again = await runRetention(); expect(Object.values(again).every((n) => typeof n === "number")).toBe(true);
    expect(RETENTION.deliveredEmailDays).toBe(90); expect(RETENTION.stuckQueuedEmailDays).toBe(30);
  });
});

describe("deletion ledger (so restores can re-apply erasures)", () => {
  it("records every self-service erasure with only an opaque id", async () => {
    const u = await makeUser("worker"); await deleteAccount(u.id, "CorrectHorse9", "DELETE");
    const [row] = await db.select().from(deletionLedger).where(eq(deletionLedger.userId, u.id)); expect(row.source).toBe("self_service");
    expect(JSON.stringify(row)).not.toContain(u.email);
  });
  it("re-applying an erasure to a person who still exists (as in a restored old backup) anonymises them, and is idempotent", async () => {
    const u = await makeUser("worker");
    expect(await anonymiseUser(u.id, "restore_reapply")).toBe(true);
    const [after] = await db.select().from(users).where(eq(users.id, u.id)); expect(after).toMatchObject({ status: "deleted", fullName: "Deleted" }); expect(after.email).toMatch(/^deleted\+/);
    expect(await anonymiseUser(u.id, "restore_reapply")).toBe(false);
    expect((await db.select().from(deletionLedger).where(eq(deletionLedger.userId, u.id))).length).toBe(1);
  });
  it("an id that isn't in the restored database is simply recorded (the person was created after that backup)", async () => {
    const ghost = crypto.randomUUID(); expect(await anonymiseUser(ghost, "restore_reapply")).toBe(false);
    expect((await db.select().from(deletionLedger).where(eq(deletionLedger.userId, ghost))).length).toBe(1);
  });
});

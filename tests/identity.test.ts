import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { desc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { authTokens, emailOutbox, sessions, users } from "@/server/db/schema";
import { authenticate, registerUser, requestPasswordReset, resetPassword, ServiceError, verifyEmail } from "@/server/services/identity";
import { closeDb, freshDb, makeUser } from "./helpers";

beforeAll(freshDb);
afterAll(closeDb);

describe("registration", () => {
  it("creates a worker with hashed password, consents and a pending email verification", async () => {
    const u = await makeUser("worker", { verify: false });
    expect(u.passwordHash).toMatch(/^\$argon2id\$/);
    expect(u.emailVerifiedAt).toBeNull();
  });
  it("rejects duplicate emails case-insensitively", async () => {
    await makeUser("worker", { email: "dup@test.example" });
    await expect(registerUser({ kind: "worker", fullName: "X Y", email: "DUP@test.example", password: "CorrectHorse9", acceptTerms: true })).rejects.toThrow(/already exists/);
  });
  it("rejects weak passwords and missing consent", async () => {
    await expect(registerUser({ kind: "worker", fullName: "X Y", email: "w1@test.example", password: "short1", acceptTerms: true })).rejects.toThrow();
    await expect(registerUser({ kind: "worker", fullName: "X Y", email: "w2@test.example", password: "alllettersnonumber", acceptTerms: true })).rejects.toThrow();
    await expect(registerUser({ kind: "worker", fullName: "X Y", email: "w3@test.example", password: "CorrectHorse9", acceptTerms: false })).rejects.toThrow();
  });
  it("requires a business name for business accounts", async () => {
    await expect(registerUser({ kind: "business", fullName: "X Y", email: "b1@test.example", password: "CorrectHorse9", acceptTerms: true })).rejects.toThrow(/name is required/);
  });
});

describe("email verification", () => {
  it("verifies once; the link cannot be reused; invalid tokens fail", async () => {
    const u = await makeUser("worker", { verify: false });
    const [mail] = await db.select().from(emailOutbox).where(eq(emailOutbox.toEmail, u.email)).orderBy(desc(emailOutbox.createdAt));
    const token = new URL(mail.link!).searchParams.get("token")!;
    await verifyEmail(token);
    expect((await db.select().from(users).where(eq(users.id, u.id)))[0].emailVerifiedAt).not.toBeNull();
    await expect(verifyEmail(token)).rejects.toThrow(/invalid or has expired/);
    await expect(verifyEmail("garbage")).rejects.toThrow();
  });
  it("stores only token hashes", async () => {
    const rows = await db.select().from(authTokens);
    for (const r of rows) expect(r.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("login and password reset", () => {
  it("logs in with correct credentials and rejects wrong ones with one generic message", async () => {
    const u = await makeUser("worker");
    expect((await authenticate(u.email, "CorrectHorse9", "ip-a")).id).toBe(u.id);
    const e1 = await authenticate(u.email, "wrong-password1", "ip-a").catch((e) => e);
    const e2 = await authenticate("nobody@test.example", "wrong-password1", "ip-a").catch((e) => e);
    expect(e1).toBeInstanceOf(ServiceError);
    expect(e1.message).toBe(e2.message);
  });
  it("rate-limits repeated failed logins", async () => {
    const email = "ratelimit@test.example";
    let last: any;
    for (let i = 0; i < 10; i++) last = await authenticate(email, "nope-nope-1", "ip-rl").catch((e) => e);
    expect(last.code).toBe("rate_limited");
  });
  it("blocks suspended accounts", async () => {
    const u = await makeUser("worker");
    await db.update(users).set({ status: "suspended" }).where(eq(users.id, u.id));
    await expect(authenticate(u.email, "CorrectHorse9", "ip-s")).rejects.toThrow(/not active/);
  });
  it("resets a password, invalidates the token and signs out existing sessions", async () => {
    const u = await makeUser("worker");
    await db.insert(sessions).values({ userId: u.id, tokenHash: "x".repeat(64) + u.id, expiresAt: new Date(Date.now() + 1e6) });
    await requestPasswordReset(u.email);
    const [mail] = await db.select().from(emailOutbox).where(eq(emailOutbox.toEmail, u.email)).orderBy(desc(emailOutbox.createdAt));
    const token = new URL(mail.link!).searchParams.get("token")!;
    await resetPassword(token, "NewPassword42");
    expect((await authenticate(u.email, "NewPassword42", "ip-r")).id).toBe(u.id);
    await expect(authenticate(u.email, "CorrectHorse9", "ip-r")).rejects.toThrow();
    await expect(resetPassword(token, "AnotherPass77")).rejects.toThrow(/invalid or has expired/);
    expect(await db.select().from(sessions).where(eq(sessions.userId, u.id))).toHaveLength(0);
  });
  it("does not reveal whether an email exists on reset request", async () => {
    await expect(requestPasswordReset("ghost@test.example")).resolves.toBeUndefined();
  });
});

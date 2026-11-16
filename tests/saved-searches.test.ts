import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { emailOutbox, notifications, opportunities, savedSearches, users } from "@/server/db/schema";
import { cleanParams, deleteSearch, listSearches, runSavedSearchAlerts, saveSearch, setAlerts } from "@/server/services/saved-searches";
import { saveOpportunity } from "@/server/services/opportunities";
import { getBusinessForUser } from "@/server/services/business";
import { savePrefs } from "@/server/notify";
import { closeDb, freshDb, makeUser, ref } from "./helpers";

beforeAll(freshDb);
afterAll(closeDb);

async function publish(title: string, extra: Record<string, unknown> = {}) {
  const { cat } = await ref(); const b = await makeUser("business"); const biz = (await getBusinessForUser(b.id))!.b;
  return saveOpportunity(b.id, biz.id, { title, description: "A description that is comfortably long enough to pass the minimum length rule for postings.", engagementType: "micro_task", categoryId: cat.id, arrangement: "remote", payType: "hourly", payMin: 30, payMax: 40, ...extra }, { publish: true });
}
const alertsFor = (userId: string) => db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.type, "alert")));
const unique = () => `zq${Math.random().toString(36).slice(2, 8)}`;

describe("saved searches", () => {
  it("stores only known filter keys with short values", () => {
    expect(cleanParams({ q: " excel ", arrangement: "remote", evil: "x", skill: "y".repeat(101), minPay: "", extra: { a: 1 } })).toEqual({ q: "excel", arrangement: "remote" });
  });
  it("needs a name and at least one filter, rejects malformed ids, and caps at 10", async () => {
    const w = await makeUser("worker");
    await expect(saveSearch(w.id, "x", { q: "a" }, false)).rejects.toThrow();
    await expect(saveSearch(w.id, "Everything", {}, false)).rejects.toThrow(/at least one filter/);
    await expect(saveSearch(w.id, "Bad", { category: "'; drop table users;--" }, false)).rejects.toThrow(/Invalid filter/);
    for (let i = 0; i < 10; i++) await saveSearch(w.id, `Search ${i}`, { q: `term${i}` }, false);
    await expect(saveSearch(w.id, "Eleventh", { q: "more" }, false)).rejects.toThrow(/up to 10/);
    expect(await listSearches(w.id)).toHaveLength(10);
  });
  it("users cannot delete or change other users' searches", async () => {
    const a = await makeUser("worker"); const b = await makeUser("worker");
    await saveSearch(a.id, "Mine", { q: "excel" }, false); const [s] = await listSearches(a.id);
    await deleteSearch(b.id, s.id); await setAlerts(b.id, s.id, true);
    const [after] = await listSearches(a.id); expect(after.alertsEnabled).toBe(false);
    await deleteSearch(a.id, s.id); expect(await listSearches(a.id)).toHaveLength(0);
  });
});

describe("alert digests", () => {
  it("notifies once per search for new matches only, never repeats, and ignores non-matching or older listings", async () => {
    const term = unique(); const w = await makeUser("worker");
    const old = await publish(`${term} old listing before the alert`);
    await db.update(opportunities).set({ publishedAt: new Date(Date.now() - 2 * 3600_000) }).where(eq(opportunities.id, old.id)); // genuinely older than the search
    await saveSearch(w.id, "My term", { q: term }, true);
    await runSavedSearchAlerts(); // establishes nothing new: the listing predates the search
    expect(await alertsFor(w.id)).toHaveLength(0);
    await db.update(savedSearches).set({ lastAlertedAt: new Date(Date.now() - 60_000) }).where(eq(savedSearches.userId, w.id));
    await publish(`${term} first new match`); await publish(`${term} second new match`); await publish("completely unrelated posting about gardening");
    const r = await runSavedSearchAlerts();
    expect(r.notified).toBeGreaterThanOrEqual(1);
    const n = await alertsFor(w.id); expect(n).toHaveLength(1); // digest: ONE notification for two matches
    expect(n[0].title).toMatch(/2 new matches/); expect(n[0].body).toMatch(/first new match|second new match/); expect(n[0].body).not.toMatch(/gardening/);
    await runSavedSearchAlerts(); expect(await alertsFor(w.id)).toHaveLength(1); // nothing new → no repeat
  });
  it("does nothing when alerts are off; turning alerts on resets the baseline (no flood of old listings)", async () => {
    const term = unique(); const w = await makeUser("worker");
    await saveSearch(w.id, "Quiet", { q: term }, false); const [s] = await listSearches(w.id);
    await db.update(savedSearches).set({ lastAlertedAt: new Date(Date.now() - 3600_000) }).where(eq(savedSearches.id, s.id));
    await publish(`${term} while alerts were off`); await runSavedSearchAlerts();
    expect(await alertsFor(w.id)).toHaveLength(0);
    await setAlerts(w.id, s.id, true); await runSavedSearchAlerts();
    expect(await alertsFor(w.id)).toHaveLength(0); // the earlier listing is not alerted retroactively
    await publish(`${term} after alerts on`); await new Promise((r) => setTimeout(r, 20)); await runSavedSearchAlerts();
    expect(await alertsFor(w.id)).toHaveLength(1);
  });
  it("skips suspended accounts, and the email honours the alerts preference", async () => {
    const term = unique(); const sus = await makeUser("worker"); const quiet = await makeUser("worker"); const loud = await makeUser("worker");
    for (const u of [sus, quiet, loud]) { await saveSearch(u.id, "Term search", { q: term }, true); await db.update(savedSearches).set({ lastAlertedAt: new Date(Date.now() - 60_000) }).where(eq(savedSearches.userId, u.id)); }
    await db.update(users).set({ status: "suspended" }).where(eq(users.id, sus.id)); await savePrefs(quiet.id, { alerts: false });
    await publish(`${term} fresh listing`); await runSavedSearchAlerts();
    expect(await alertsFor(sus.id)).toHaveLength(0);
    expect(await alertsFor(quiet.id)).toHaveLength(1); expect(await alertsFor(loud.id)).toHaveLength(1); // in-app always
    expect(await db.select().from(emailOutbox).where(and(eq(emailOutbox.userId, quiet.id), eq(emailOutbox.category, "alerts")))).toHaveLength(0);
    expect(await db.select().from(emailOutbox).where(and(eq(emailOutbox.userId, loud.id), eq(emailOutbox.category, "alerts")))).toHaveLength(1);
  });
});

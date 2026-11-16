import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { assignments, skills } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { getBusinessForUser, listBusinessOpportunities } from "@/server/services/business";
import { saveOpportunity, searchOpportunities } from "@/server/services/opportunities";
import { applyToOpportunity, businessSetApplicationStatus, workerSetApplicationStatus } from "@/server/services/applications";
import { workerAction } from "@/server/services/assignments";
import { closeDb, freshDb, makeUser, ref } from "./helpers";

beforeAll(freshDb);
afterAll(closeDb);

describe("correlated subqueries reference the outer table correctly", () => {
  it("business opportunity list reports the real applicant count", async () => {
    const { cat } = await ref(); const b = await makeUser("business"); const biz = (await getBusinessForUser(b.id))!.b;
    const o = await saveOpportunity(b.id, biz.id, { title: "Applicant count check", description: "A description that is comfortably long enough to pass the minimum length rule.", engagementType: "micro_task", categoryId: cat.id, arrangement: "remote", payType: "hourly", payMin: 30, payMax: 40 }, { publish: true });
    for (let i = 0; i < 3; i++) { const w = await makeUser("worker"); await applyToOpportunity(w.id, { opportunityId: o.id, proposal: "I have five years of relevant experience and can start right away." }); }
    expect((await listBusinessOpportunities(biz.id)).find((x) => x.o.id === o.id)!.applicants).toBe(3);
  });
  it("one-shot submit is refused for a recurring assignment (schedule rows are counted for the right opportunity)", async () => {
    const { cat } = await ref(); const b = await makeUser("business"); const biz = (await getBusinessForUser(b.id))!.b; const w = await makeUser("worker"); const sk = await db.select().from(skills);
    const o = await saveOpportunity(b.id, biz.id, { title: "Weekly recurring support", description: "Regular weekly support shared on set mornings for a small office team.", engagementType: "recurring", categoryId: cat.id, arrangement: "remote", payType: "recurring", payMin: 500, payMax: 600, hoursPerWeek: 4, schedule: [{ weekday: 2, startMinute: 600, endMinute: 720 }], skillIds: [sk[0].id] }, { publish: true });
    const a = await applyToOpportunity(w.id, { opportunityId: o.id, proposal: "I have five years of relevant experience and can start right away." });
    await businessSetApplicationStatus(b.id, a.id, "offer_received"); await workerSetApplicationStatus(w.id, a.id, "accepted");
    const [asg] = await db.select().from(assignments).where(eq(assignments.applicationId, a.id));
    await expect(workerAction(w.id, asg.id, "submit", { note: "Everything delivered in one go" })).rejects.toThrow(/recurring assignment/);
  });

  it("search filters by skill and by scheduled weekday using the right opportunity", async () => {
    const { cat } = await ref(); const b = await makeUser("business"); const biz = (await getBusinessForUser(b.id))!.b; const sk = await db.select().from(skills);
    const base = { description: "A description that is comfortably long enough to pass the minimum length rule.", engagementType: "recurring", categoryId: cat.id, arrangement: "remote", payType: "hourly", payMin: 30, payMax: 40, hoursPerWeek: 3 };
    const tue = await saveOpportunity(b.id, biz.id, { ...base, title: "Tuesday only opportunity", schedule: [{ weekday: 2, startMinute: 600, endMinute: 720 }], skillIds: [sk[3].id] }, { publish: true });
    const fri = await saveOpportunity(b.id, biz.id, { ...base, title: "Friday only opportunity", schedule: [{ weekday: 5, startMinute: 600, endMinute: 720 }], skillIds: [sk[4].id] }, { publish: true });
    const ids = (r: Awaited<ReturnType<typeof searchOpportunities>>) => r.items.map((i) => i.o.id);
    const bySkill = ids(await searchOpportunities({ skill: sk[3].id })); expect(bySkill).toContain(tue.id); expect(bySkill).not.toContain(fri.id);
    const byDay = ids(await searchOpportunities({ weekday: 5 })); expect(byDay).toContain(fri.id); expect(byDay).not.toContain(tue.id);
  });
});

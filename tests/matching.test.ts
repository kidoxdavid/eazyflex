import { describe, expect, it } from "vitest";
import { coveredMinutes, DEFAULT_RULES, scoreMatch, unavailableShare, type MatchOpportunity, type MatchWorker } from "@/server/matching/score";

const CAL = { lat: 51.0447, lng: -114.0719 };
const worker = (o: Partial<MatchWorker> = {}): MatchWorker => ({
  arrangements: ["remote"], engagementTypes: [], categoryIds: [], skillIds: ["excel", "email"],
  experienceLevel: "intermediate", area: CAL, travelRadiusKm: 15,
  availability: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 570, endMinute: 840 })), // Mon–Fri 9:30–14:00
  unavailability: [], availabilityPaused: false, maxHoursPerWeek: 20, minAssignmentDays: null, maxAssignmentDays: null,
  preferredHourlyCents: 3000, minHourlyCents: 2500, minHourlyIsHard: false, preferredFixedCents: null, willingToNegotiate: true, ...o,
});
const opp = (o: Partial<MatchOpportunity> = {}): MatchOpportunity => ({
  arrangement: "remote", engagementType: "recurring", categoryId: null, payType: "hourly", payMinCents: 2800, payMaxCents: 3200,
  experienceLevel: "entry", skills: [{ skillId: "excel", name: "Excel", mandatory: true }, { skillId: "email", name: "Email management", mandatory: false }],
  schedule: [{ weekday: 2, startMinute: 600, endMinute: 720 }], startDate: null, endDate: null, hoursPerWeek: 2, area: null, ...o,
});

describe("matching: skills", () => {
  it("scores a full skills match and explains it", () => {
    const r = scoreMatch(opp(), worker());
    expect(r.eligible).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.reasons.find((x) => x.criterion === "skills")?.text).toMatch(/all 2 requested skills/);
  });
  it("treats a missing mandatory skill as a blocker, not a score penalty", () => {
    const r = scoreMatch(opp(), worker({ skillIds: ["email"] }));
    expect(r.eligible).toBe(false);
    expect(r.blockers.join()).toMatch(/Missing required skill: Excel/);
    expect(r.tier).toBe("not_recommended");
  });
  it("a missing preferred skill only lowers the score", () => {
    const r = scoreMatch(opp(), worker({ skillIds: ["excel"] }));
    expect(r.eligible).toBe(true);
    expect(r.reasons.find((x) => x.criterion === "skills")?.status).toBe("partial");
  });
});

describe("matching: availability uses real days/hours", () => {
  it("covers a Tuesday 10:00–12:00 slot inside Mon–Fri 9:30–14:00", () => {
    expect(coveredMinutes({ weekday: 2, startMinute: 600, endMinute: 720 }, worker().availability)).toBe(120);
  });
  it("blocks when the required hours fall outside availability (weekday evening)", () => {
    const r = scoreMatch(opp({ schedule: [{ weekday: 2, startMinute: 1200, endMinute: 1320 }] }), worker());
    expect(r.eligible).toBe(false);
    expect(r.blockers.join()).toMatch(/Not available during/);
  });
  it("blocks when availability is paused", () => {
    expect(scoreMatch(opp(), worker({ availabilityPaused: true })).eligible).toBe(false);
  });
  it("gives partial credit for partial overlap and merges overlapping windows without double counting", () => {
    const r = scoreMatch(opp({ schedule: [{ weekday: 2, startMinute: 780, endMinute: 900 }] }), worker());
    expect(r.eligible).toBe(true);
    expect(r.reasons.find((x) => x.criterion === "availability")?.text).toMatch(/50%/);
    expect(coveredMinutes({ weekday: 1, startMinute: 0, endMinute: 200 }, [
      { weekday: 1, startMinute: 0, endMinute: 100 }, { weekday: 1, startMinute: 50, endMinute: 150 }])).toBe(150);
  });
  it("blocks when the whole scheduled date range is marked unavailable", () => {
    const o = opp({ startDate: "2026-12-01", endDate: "2026-12-05", schedule: [{ weekday: 2, startMinute: 600, endMinute: 720 }] });
    const w = worker({ unavailability: [{ start: "2026-11-30", end: "2026-12-31" }] });
    expect(unavailableShare(o, w.unavailability)).toBe(1);
    expect(scoreMatch(o, w).eligible).toBe(false);
  });
  it("flags hours-per-week above the worker's maximum", () => {
    const r = scoreMatch(opp({ hoursPerWeek: 30 }), worker({ maxHoursPerWeek: 10 }));
    expect(r.reasons.some((x) => x.status === "gap" && /maximum is 10/.test(x.text))).toBe(true);
  });
});

describe("matching: location", () => {
  const nearby = { lat: 51.06, lng: -114.09 };
  it("is irrelevant for remote work", () => expect(scoreMatch(opp({ arrangement: "remote" }), worker({ area: null })).eligible).toBe(true));
  it("accepts local work inside the travel radius", () => {
    const r = scoreMatch(opp({ arrangement: "local", area: nearby }), worker({ arrangements: ["local"] }));
    expect(r.reasons.find((x) => x.criterion === "location")?.status).toBe("match");
  });
  it("blocks local work outside the travel radius", () => {
    const r = scoreMatch(opp({ arrangement: "local", area: { lat: 53.5461, lng: -113.4938 } }), worker({ arrangements: ["local"] }));
    expect(r.eligible).toBe(false);
    expect(r.blockers.join()).toMatch(/outside your 15 km/);
  });
  it("reports unknown (not match) when location data is missing", () => {
    const r = scoreMatch(opp({ arrangement: "local", area: null }), worker());
    expect(r.reasons.find((x) => x.criterion === "location")?.status).toBe("unknown");
  });
});

describe("matching: compensation", () => {
  it("does NOT exclude on a soft minimum, only on an explicit hard minimum", () => {
    const o = opp({ payMinCents: 1800, payMaxCents: 2000 });
    const soft = scoreMatch(o, worker({ minHourlyIsHard: false }));
    expect(soft.eligible).toBe(true);
    const hard = scoreMatch(o, worker({ minHourlyIsHard: true }));
    expect(hard.eligible).toBe(false);
    expect(hard.blockers.join()).toMatch(/below your minimum/);
  });
  it("is unknown (excluded from the score) for a non-hourly opportunity without a comparable preference", () => {
    const r = scoreMatch(opp({ payType: "fixed" }), worker());
    expect(r.reasons.find((x) => x.criterion === "compensation")?.status).toBe("unknown");
  });
});

describe("matching: honesty and configuration", () => {
  it("never shows 100/100 when most criteria could not be assessed", () => {
    const sparse = scoreMatch(opp({ skills: [], schedule: [], payType: "fixed" }), worker({ arrangements: ["remote"] }));
    expect(sparse.eligible).toBe(true);
    expect(sparse.coverage).toBeLessThan(0.5);
    expect(sparse.score).toBeLessThan(80);
    expect(sparse.tier).not.toBe("strong");
  });
  it("a fully assessable perfect match can still score highly", () => {
    const full = scoreMatch(opp(), worker());
    expect(full.coverage).toBeGreaterThan(0.7);
    expect(full.score).toBeGreaterThanOrEqual(85);
  });
  it("never labels a match 'strong' when there are gaps", () => {
    const r = scoreMatch(opp(), worker({ skillIds: ["excel"], arrangements: ["local"] }));
    expect(r.tier).not.toBe("strong");
    expect(r.explanation).toMatch(/Things to check/);
  });
  it("weights are configurable: zeroing the skills weight changes the score", () => {
    const base = scoreMatch(opp(), worker({ skillIds: ["excel"] }));
    const rules = { ...DEFAULT_RULES, weights: { ...DEFAULT_RULES.weights, skills: 0 } };
    expect(scoreMatch(opp(), worker({ skillIds: ["excel"] }), rules).score).toBeGreaterThan(base.score);
  });
  it("mandatory set is configurable", () => {
    const rules = { ...DEFAULT_RULES, mandatory: [] as never[] };
    expect(scoreMatch(opp(), worker({ skillIds: [] }), rules).eligible).toBe(true);
  });
  it("explanations only cite recorded facts (no invented reasons)", () => {
    const r = scoreMatch(opp(), worker());
    for (const reason of r.reasons) expect(r.explanation.includes(reason.text) || reason.status === "unknown").toBe(true);
  });
});

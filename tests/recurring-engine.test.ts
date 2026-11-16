import { describe, expect, it } from "vitest";
import { addDays, daysBetween, generateOccurrences, MAX_OCCURRENCES, needsRenewalReminder, renewalDateError, termBlockers, today, weekdayOf } from "@/server/recurring/engine";

const TUE_THU = [{ weekday: 2, startMinute: 600, endMinute: 720 }, { weekday: 4, startMinute: 600, endMinute: 720 }];

describe("date helpers", () => {
  it("adds days across month and year boundaries and computes weekdays", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02"); expect(addDays("2028-02-28", 1)).toBe("2028-02-29"); expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(weekdayOf("2026-11-17")).toBe(2); // Tuesday
    expect(daysBetween("2026-11-16", "2026-12-16")).toBe(30);
  });
  it("rejects malformed dates", () => { expect(() => addDays("2026-13-45", 1)).toThrow(); expect(() => addDays("tomorrow", 1)).toThrow(); });
  it("today() is the UTC calendar date", () => expect(today(new Date("2026-11-16T23:59:59Z"))).toBe("2026-11-16"));
});

describe("occurrence generation", () => {
  it("produces the right dated sessions for a bounded term", () => {
    const o = generateOccurrences({ schedule: TUE_THU, start: "2026-11-16", end: "2026-11-27", from: "2026-11-16", horizonDays: 90 });
    expect(o.map((x) => x.occursOn)).toEqual(["2026-11-17", "2026-11-19", "2026-11-24", "2026-11-26"]);
    expect(o.every((x) => x.startMinute === 600 && x.endMinute === 720)).toBe(true);
  });
  it("includes both boundary days when they match a scheduled weekday", () => {
    const o = generateOccurrences({ schedule: TUE_THU, start: "2026-11-17", end: "2026-11-19", from: "2026-11-01", horizonDays: 90 });
    expect(o.map((x) => x.occursOn)).toEqual(["2026-11-17", "2026-11-19"]);
  });
  it("never goes before `from` (no backfilling past sessions the caller didn't ask for) or beyond the end date", () => {
    const o = generateOccurrences({ schedule: TUE_THU, start: "2026-10-01", end: "2026-12-31", from: "2026-11-16", horizonDays: 14 });
    expect(o[0].occursOn >= "2026-11-16").toBe(true); expect(o.at(-1)!.occursOn <= "2026-11-30").toBe(true);
  });
  it("open-ended terms are limited to the rolling horizon", () => {
    const o = generateOccurrences({ schedule: TUE_THU, start: "2026-11-16", end: null, from: "2026-11-16", horizonDays: 28 });
    expect(o).toHaveLength(8); expect(o.at(-1)!.occursOn <= "2026-12-14").toBe(true);
  });
  it("handles several windows on one day in order and an empty schedule", () => {
    const sched = [{ weekday: 2, startMinute: 780, endMinute: 840 }, { weekday: 2, startMinute: 540, endMinute: 600 }];
    expect(generateOccurrences({ schedule: sched, start: "2026-11-17", end: "2026-11-17", from: "2026-11-17", horizonDays: 7 }).map((x) => x.startMinute)).toEqual([540, 780]);
    expect(generateOccurrences({ schedule: [], start: "2026-11-17", end: null, from: "2026-11-17", horizonDays: 30 })).toEqual([]);
  });
  it("returns nothing when the term has not started within the horizon or has already ended", () => {
    expect(generateOccurrences({ schedule: TUE_THU, start: "2027-06-01", end: null, from: "2026-11-16", horizonDays: 30 })).toEqual([]);
    expect(generateOccurrences({ schedule: TUE_THU, start: "2026-01-01", end: "2026-02-01", from: "2026-11-16", horizonDays: 30 })).toEqual([]);
  });
  it("is capped", () => {
    const daily = [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) => [0, 1, 2, 3, 4].map((i) => ({ weekday, startMinute: i * 60, endMinute: i * 60 + 30 })));
    expect(generateOccurrences({ schedule: daily, start: "2026-01-01", end: null, from: "2026-01-01", horizonDays: 3650 }).length).toBe(MAX_OCCURRENCES);
  });
});

describe("term end and renewal rules", () => {
  it("blocks ending while past sessions are unresolved or completed ones unconfirmed", () => {
    const t = "2026-11-20";
    expect(termBlockers([{ occursOn: "2026-11-17", status: "scheduled", confirmed: false }], t)).toEqual({ unresolved: 1, unconfirmed: 0, canEnd: false });
    expect(termBlockers([{ occursOn: "2026-11-17", status: "completed", confirmed: false }], t)).toEqual({ unresolved: 0, unconfirmed: 1, canEnd: false });
    expect(termBlockers([{ occursOn: "2026-11-17", status: "completed", confirmed: true }, { occursOn: "2026-11-18", status: "missed", confirmed: false }, { occursOn: "2026-11-19", status: "cancelled", confirmed: false }, { occursOn: "2026-11-24", status: "scheduled", confirmed: false }], t).canEnd).toBe(true); // future scheduled sessions don't block
  });
  it("reminds only within 14 days before the end, never for open-ended or ended terms", () => {
    expect(needsRenewalReminder("2026-11-30", "2026-11-16")).toBe(true); expect(needsRenewalReminder("2026-12-01", "2026-11-16")).toBe(false);
    expect(needsRenewalReminder("2026-11-16", "2026-11-16")).toBe(true); expect(needsRenewalReminder("2026-11-15", "2026-11-16")).toBe(false); expect(needsRenewalReminder(null, "2026-11-16")).toBe(false);
  });
  it("validates renewal dates", () => {
    const t = "2026-11-16";
    expect(renewalDateError("2026-12-01", "2027-03-01", t)).toBeNull();
    expect(renewalDateError(null, "2027-03-01", t)).toMatch(/no end date/);
    expect(renewalDateError("2026-12-01", "2026-12-01", t)).toMatch(/after the current end/);
    expect(renewalDateError("2026-12-01", "2028-01-01", t)).toMatch(/one year/);
    expect(renewalDateError("2026-11-01", "2027-01-01", t)).toMatch(/already ended/);
    expect(renewalDateError("2026-12-01", "soon", t)).toMatch(/valid date/);
  });
});

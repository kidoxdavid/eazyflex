import { describe, expect, it } from "vitest";
import { analyseCoverage, contains, findHandovers, intersectWindows, mergeWindows, subtractWindows, suggestCoverage, totalMinutes, type Candidate, type Slice, type Win } from "@/server/coverage/engine";

const w = (weekday: number, s: number, e: number): Win => ({ weekday, startMinute: s * 60, endMinute: e * 60 });
const sl = (id: string, workerId: string, weekday: number, s: number, e: number, status: Slice["status"] = "confirmed"): Slice => ({ id, workerId, weekday, startMinute: s * 60, endMinute: e * 60, status });
// 30 h/week of support: Mon–Fri 9:00–15:00
const REQ = [1, 2, 3, 4, 5].map((d) => w(d, 9, 15));

describe("window arithmetic", () => {
  it("merges overlapping and touching windows per day", () => {
    expect(mergeWindows([w(1, 9, 11), w(1, 10, 12), w(1, 12, 13), w(2, 9, 10)])).toEqual([w(1, 9, 13), w(2, 9, 10)]);
  });
  it("subtracts, including splitting a window in two", () => {
    expect(subtractWindows([w(1, 9, 15)], [w(1, 11, 12)])).toEqual([w(1, 9, 11), w(1, 12, 15)]);
    expect(subtractWindows([w(1, 9, 15)], [w(2, 9, 15)])).toEqual([w(1, 9, 15)]);
    expect(subtractWindows([w(1, 9, 15)], [w(1, 8, 16)])).toEqual([]);
  });
  it("intersects and tests containment", () => {
    expect(intersectWindows([w(1, 9, 15)], [w(1, 12, 20)])).toEqual([w(1, 12, 15)]);
    expect(contains([w(1, 9, 15)], w(1, 10, 12))).toBe(true);
    expect(contains([w(1, 9, 15)], w(1, 14, 16))).toBe(false);
    expect(totalMinutes(REQ)).toBe(30 * 60);
  });
});

describe("coverage analysis", () => {
  it("reports required, confirmed and planned minutes and the exact gaps", () => {
    const r = analyseCoverage(REQ, [sl("a", "A", 1, 9, 15), sl("b", "B", 2, 9, 12), sl("c", "C", 2, 12, 15, "proposed")]);
    expect(r.requiredMinutes).toBe(1800); expect(r.confirmedMinutes).toBe(360 + 180);
    expect(r.plannedMinutes).toBe(360 + 360);
    expect(r.confirmedGaps).toEqual([w(2, 12, 15), w(3, 9, 15), w(4, 9, 15), w(5, 9, 15)]);
    expect(r.plannedGaps).toEqual([w(3, 9, 15), w(4, 9, 15), w(5, 9, 15)]);
    expect(r.complete).toBe(false); expect(r.percentConfirmed).toBe(30);
  });
  it("is complete only when confirmed slices cover everything (proposed ones don't count)", () => {
    const full = REQ.map((x, i) => sl("s" + i, "W" + (i % 3), x.weekday, 9, 15));
    expect(analyseCoverage(REQ, full).complete).toBe(true);
    expect(analyseCoverage(REQ, full.map((s) => ({ ...s, status: "proposed" as const }))).complete).toBe(false);
    expect(analyseCoverage(REQ, full.map((s, i) => (i === 0 ? { ...s, status: "released" as const } : s))).complete).toBe(false);
  });
  it("detects overlaps between different workers and ignores a worker overlapping themselves", () => {
    const r = analyseCoverage(REQ, [sl("a", "A", 1, 9, 12), sl("b", "B", 1, 11, 14), sl("c", "A", 1, 10, 11)]);
    expect(r.overlaps).toHaveLength(1); // only A(9-12)&B(11-14) overlap (11-12); A(10-11) merely touches B(11-14); A overlapping A is ignored
    expect(r.overlaps.find((o) => o.startMinute === 660 && o.endMinute === 720)?.workerIds).toEqual(["A", "B"]);
    expect(r.overlaps.every((o) => o.workerIds[0] !== o.workerIds[1] && o.endMinute > o.startMinute)).toBe(true);
    expect(analyseCoverage(REQ, [sl("a", "A", 1, 9, 12), sl("c", "A", 1, 10, 11)]).overlaps).toEqual([]);
  });
  it("flags slices extending beyond the required windows", () => {
    expect(analyseCoverage(REQ, [sl("a", "A", 1, 14, 17)]).outsideDemand.map((s) => s.id)).toEqual(["a"]);
    expect(analyseCoverage(REQ, [sl("a", "A", 6, 9, 10)]).outsideDemand).toHaveLength(1);
  });
  it("tracks per-worker minutes", () => {
    const r = analyseCoverage(REQ, [sl("a", "A", 1, 9, 12), sl("b", "A", 2, 9, 12), sl("c", "B", 3, 9, 12, "proposed")]);
    expect(r.byWorker.find((x) => x.workerId === "A")!.confirmedMinutes).toBe(360);
    expect(r.byWorker.find((x) => x.workerId === "B")).toMatchObject({ confirmedMinutes: 0, proposedMinutes: 180 });
  });
  it("handles empty demand without dividing by zero", () => {
    const r = analyseCoverage([], []); expect(r.percentConfirmed).toBe(0); expect(r.complete).toBe(false);
  });
});

const cand = (workerId: string, score: number, availability: Win[], extra: Partial<Candidate> = {}): Candidate => ({ workerId, score, availability, commitments: [], maxMinutesPerWeek: null, ...extra });

describe("coverage suggestions", () => {
  it("splits 30 h across four part-time workers (the work-sharing example) with no gaps and no overlaps", () => {
    const cs = [
      cand("A", 90, [w(1, 9, 15), w(2, 9, 15)], { maxMinutesPerWeek: 12 * 60 }),
      cand("B", 80, [w(3, 9, 15), w(4, 9, 12)], { maxMinutesPerWeek: 10 * 60 }),
      cand("C", 70, [w(4, 12, 15), w(5, 9, 12)], { maxMinutesPerWeek: 10 * 60 }),
      cand("D", 60, [w(5, 12, 15)], { maxMinutesPerWeek: 5 * 60 }),
    ];
    const { suggestions, remainingGaps } = suggestCoverage(REQ, cs);
    expect(remainingGaps).toEqual([]);
    const slices = suggestions.map((s, i) => ({ ...s, id: "x" + i, status: "proposed" as const }));
    const r = analyseCoverage(REQ, slices); expect(r.plannedGaps).toEqual([]); expect(r.overlaps).toEqual([]); expect(r.outsideDemand).toEqual([]);
    expect(new Set(suggestions.map((s) => s.workerId)).size).toBe(4);
  });
  it("never suggests time outside a worker's stated availability", () => {
    const cs = [cand("A", 90, [w(1, 10, 12)])];
    const { suggestions } = suggestCoverage(REQ, cs);
    expect(suggestions).toEqual([{ workerId: "A", weekday: 1, startMinute: 600, endMinute: 720 }]);
  });
  it("respects the weekly hour cap and leaves the rest as an honest gap", () => {
    const { suggestions, remainingGaps } = suggestCoverage(REQ, [cand("A", 90, REQ, { maxMinutesPerWeek: 8 * 60 })]);
    expect(totalMinutes(suggestions.map((s) => ({ weekday: s.weekday, startMinute: s.startMinute, endMinute: s.endMinute })))).toBe(8 * 60);
    expect(totalMinutes(remainingGaps)).toBe(22 * 60);
  });
  it("avoids times the worker is already committed elsewhere", () => {
    const { suggestions } = suggestCoverage([w(1, 9, 15)], [cand("A", 90, [w(1, 9, 15)], { commitments: [w(1, 10, 12)] })]);
    for (const s of suggestions) expect(s.endMinute <= 600 || s.startMinute >= 720).toBe(true);
  });
  it("counts commitments toward the weekly cap", () => {
    const { suggestions } = suggestCoverage([w(1, 9, 15)], [cand("A", 90, [w(1, 9, 15)], { commitments: [w(2, 9, 15)], maxMinutesPerWeek: 8 * 60 })]);
    expect(totalMinutes(suggestions.map((s) => ({ weekday: s.weekday, startMinute: s.startMinute, endMinute: s.endMinute })))).toBe(2 * 60);
  });
  it("prefers the larger contiguous block, then the higher score, and is deterministic", () => {
    const cs = [cand("low", 50, [w(1, 9, 15)]), cand("high", 95, [w(1, 9, 15)])];
    const a = suggestCoverage([w(1, 9, 15)], cs), b = suggestCoverage([w(1, 9, 15)], [...cs].reverse());
    expect(a.suggestions).toEqual([{ workerId: "high", weekday: 1, startMinute: 540, endMinute: 900 }]); expect(b).toEqual(a);
  });
  it("does not double-book time already proposed or confirmed, and reports leftover gaps", () => {
    const { suggestions, remainingGaps } = suggestCoverage([w(1, 9, 15)], [cand("B", 80, [w(1, 9, 15)])], [sl("e", "A", 1, 9, 12)]);
    expect(suggestions).toEqual([{ workerId: "B", weekday: 1, startMinute: 720, endMinute: 900 }]); expect(remainingGaps).toEqual([]);
  });
  it("ignores released/declined slices when computing what is still uncovered", () => {
    const { suggestions } = suggestCoverage([w(1, 9, 12)], [cand("B", 80, [w(1, 9, 12)])], [sl("e", "A", 1, 9, 12, "released"), sl("f", "A", 1, 9, 12, "declined")]);
    expect(suggestions).toHaveLength(1);
  });
  it("does not offer slivers shorter than 30 minutes", () => {
    const { suggestions } = suggestCoverage([w(1, 9, 10)], [cand("A", 90, [{ weekday: 1, startMinute: 540, endMinute: 560 }])]);
    expect(suggestions).toEqual([]);
  });
});

describe("handovers", () => {
  it("finds adjacent confirmed slices of different workers on the same day", () => {
    const h = findHandovers([sl("a", "A", 1, 9, 12), sl("b", "B", 1, 12, 15), sl("c", "B", 2, 9, 12), sl("d", "A", 1, 15, 16, "proposed")]);
    expect(h.map((x) => [x.from.id, x.to.id])).toEqual([["a", "b"]]);
  });
});

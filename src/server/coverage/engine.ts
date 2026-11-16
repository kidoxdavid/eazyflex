/**
 * Work-sharing coverage engine. Pure functions over weekly windows (weekday + minutes). No database, no framework.
 *
 * Demand = the opportunity's required weekly windows. Supply = slices assigned to workers.
 * The engine never books anyone: it analyses coverage and *suggests* slices. A suggestion only becomes a booking when
 * the worker explicitly confirms it (enforced in services/coverage.ts).
 */
export type Win = { weekday: number; startMinute: number; endMinute: number };
export type Slice = Win & { id: string; workerId: string; status: "proposed" | "confirmed" | "declined" | "released" };
export type Overlap = Win & { workerIds: string[] };

const len = (w: Win) => w.endMinute - w.startMinute;
export const totalMinutes = (ws: Win[]) => ws.reduce((n, w) => n + len(w), 0);

/** Union of intervals per weekday, sorted, with touching intervals merged. */
export function mergeWindows(ws: Win[]): Win[] {
  const out: Win[] = [];
  for (const wd of [0, 1, 2, 3, 4, 5, 6]) {
    const day = ws.filter((w) => w.weekday === wd && w.endMinute > w.startMinute).sort((a, b) => a.startMinute - b.startMinute);
    for (const w of day) {
      const last = out[out.length - 1];
      if (last && last.weekday === wd && w.startMinute <= last.endMinute) last.endMinute = Math.max(last.endMinute, w.endMinute);
      else out.push({ ...w });
    }
  }
  return out;
}

/** a minus b (both treated as unions). */
export function subtractWindows(a: Win[], b: Win[]): Win[] {
  const bm = mergeWindows(b); const out: Win[] = [];
  for (const w of mergeWindows(a)) {
    let cur = [{ ...w }];
    for (const x of bm.filter((x) => x.weekday === w.weekday)) {
      const next: Win[] = [];
      for (const c of cur) {
        if (x.endMinute <= c.startMinute || x.startMinute >= c.endMinute) { next.push(c); continue; }
        if (x.startMinute > c.startMinute) next.push({ ...c, endMinute: x.startMinute });
        if (x.endMinute < c.endMinute) next.push({ ...c, startMinute: x.endMinute });
      }
      cur = next;
    }
    out.push(...cur);
  }
  return out;
}

export const intersectWindows = (a: Win[], b: Win[]): Win[] => subtractWindows(a, subtractWindows(a, b));
export const overlaps = (a: Win, b: Win) => a.weekday === b.weekday && a.startMinute < b.endMinute && b.startMinute < a.endMinute;
export const contains = (outer: Win[], inner: Win) => subtractWindows([inner], outer).length === 0;

export type CoverageReport = {
  requiredMinutes: number;
  confirmedMinutes: number;      // required time covered by confirmed slices
  plannedMinutes: number;        // required time covered by confirmed + proposed slices
  confirmedGaps: Win[];          // required time with no confirmed coverage
  plannedGaps: Win[];            // required time with neither confirmed nor proposed coverage
  overlaps: Overlap[];           // time where two or more active (proposed/confirmed) slices of different workers coincide
  outsideDemand: Slice[];        // active slices that extend beyond the required windows
  complete: boolean;             // every required minute is covered by confirmed slices
  percentConfirmed: number;
  byWorker: { workerId: string; confirmedMinutes: number; proposedMinutes: number }[];
};

export function analyseCoverage(required: Win[], slices: Slice[]): CoverageReport {
  const req = mergeWindows(required);
  const active = slices.filter((s) => s.status === "confirmed" || s.status === "proposed");
  const confirmed = active.filter((s) => s.status === "confirmed");
  const confirmedGaps = subtractWindows(req, confirmed);
  const plannedGaps = subtractWindows(req, active);
  const required_ = totalMinutes(req);
  const confirmedMinutes = required_ - totalMinutes(confirmedGaps);
  const plannedMinutes = required_ - totalMinutes(plannedGaps);

  const ov: Overlap[] = [];
  for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
    const a = active[i], b = active[j];
    if (a.workerId === b.workerId || !overlaps(a, b)) continue;
    ov.push({ weekday: a.weekday, startMinute: Math.max(a.startMinute, b.startMinute), endMinute: Math.min(a.endMinute, b.endMinute), workerIds: [a.workerId, b.workerId] });
  }
  const byWorker = [...new Set(active.map((s) => s.workerId))].map((workerId) => ({
    workerId,
    confirmedMinutes: totalMinutes(mergeWindows(confirmed.filter((s) => s.workerId === workerId))),
    proposedMinutes: totalMinutes(mergeWindows(active.filter((s) => s.workerId === workerId && s.status === "proposed"))),
  }));
  return {
    requiredMinutes: required_, confirmedMinutes, plannedMinutes, confirmedGaps, plannedGaps, overlaps: ov,
    outsideDemand: active.filter((s) => !contains(req, s)), complete: required_ > 0 && confirmedGaps.length === 0,
    percentConfirmed: required_ ? Math.round((confirmedMinutes / required_) * 100) : 0, byWorker,
  };
}

export type Candidate = {
  workerId: string;
  score: number;                 // explainable match score (already excludes ineligible workers)
  availability: Win[];           // the worker's stated weekly availability
  commitments: Win[];            // time the worker is already committed to elsewhere (confirmed slices on other opportunities)
  maxMinutesPerWeek: number | null;
};
export type Suggestion = { workerId: string; weekday: number; startMinute: number; endMinute: number };

export const MIN_CHUNK = 60;

/**
 * Greedy, deterministic coverage suggestion. Repeatedly gives the largest still-uncovered contiguous block that fits inside
 * one candidate's availability (and outside their other commitments and weekly cap) to the best candidate for it.
 * Ties: higher match score, then fewer minutes already given in this plan (spreads load), then workerId for stability.
 * Only suggests inside stated availability — it never proposes anyone outside their availability.
 */
export function suggestCoverage(required: Win[], candidates: Candidate[], existing: Slice[] = []): { suggestions: Suggestion[]; remainingGaps: Win[] } {
  const active = existing.filter((s) => s.status === "proposed" || s.status === "confirmed");
  let uncovered = subtractWindows(mergeWindows(required), active);
  const given = new Map<string, Win[]>();
  const loadOf = (id: string) => totalMinutes(given.get(id) ?? []);
  const out: Suggestion[] = [];

  for (let guard = 0; guard < 500; guard++) {
    let best: { c: Candidate; win: Win } | null = null;
    for (const c of candidates) {
      const mine = [...(given.get(c.workerId) ?? []), ...active.filter((s) => s.workerId === c.workerId)];
      const free = subtractWindows(subtractWindows(intersectWindows(uncovered, c.availability), c.commitments), mine);
      const cap = c.maxMinutesPerWeek == null ? Infinity : c.maxMinutesPerWeek - totalMinutes(mergeWindows(mine)) - totalMinutes(c.commitments);
      if (cap < MIN_CHUNK) continue;
      for (const w of free) {
        const size = Math.min(len(w), cap);
        if (size < MIN_CHUNK && size < len(w)) continue;
        if (size < 30) continue;
        const win = { ...w, endMinute: w.startMinute + size };
        const better = !best || len(win) > len(best.win)
          || (len(win) === len(best.win) && (c.score > best.c.score || (c.score === best.c.score && (loadOf(c.workerId) < loadOf(best.c.workerId) || (loadOf(c.workerId) === loadOf(best.c.workerId) && c.workerId < best.c.workerId)))));
        if (better) best = { c, win };
      }
    }
    if (!best) break;
    out.push({ workerId: best.c.workerId, weekday: best.win.weekday, startMinute: best.win.startMinute, endMinute: best.win.endMinute });
    given.set(best.c.workerId, [...(given.get(best.c.workerId) ?? []), best.win]);
    uncovered = subtractWindows(uncovered, [best.win]);
  }
  return { suggestions: out, remainingGaps: uncovered };
}

/** Adjacent slices of different workers on the same day (end of one == start of next): where a handover happens. */
export function findHandovers(slices: Slice[]): { from: Slice; to: Slice }[] {
  const c = slices.filter((s) => s.status === "confirmed");
  const out: { from: Slice; to: Slice }[] = [];
  for (const a of c) for (const b of c) if (a.id !== b.id && a.workerId !== b.workerId && a.weekday === b.weekday && a.endMinute === b.startMinute) out.push({ from: a, to: b });
  return out;
}

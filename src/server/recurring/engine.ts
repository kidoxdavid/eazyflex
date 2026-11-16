/**
 * Recurring-assignment date maths. Pure and calendar-date based (YYYY-MM-DD, no clock times, no time zones):
 * a schedule row means "this weekday, these minutes" in the worker's and business's shared local calendar.
 */
export type SchedWin = { weekday: number; startMinute: number; endMinute: number };
export type Occ = { occursOn: string; startMinute: number; endMinute: number };

const DAY = 86400_000;
const parse = (d: string) => { const t = Date.parse(d + "T00:00:00Z"); if (Number.isNaN(t) || !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error("bad date " + d); return t; };
export const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => ymd(parse(d) + n * DAY);
export const weekdayOf = (d: string) => new Date(parse(d)).getUTCDay();
export const daysBetween = (a: string, b: string) => Math.round((parse(b) - parse(a)) / DAY);
export const today = (now = new Date()) => ymd(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export const MAX_OCCURRENCES = 400;

/**
 * Dated sessions for a weekly schedule between `start` and `end` (inclusive), limited to [from, from + horizonDays].
 * `end = null` means an open-ended term: only the rolling horizon is produced.
 */
export function generateOccurrences(p: { schedule: SchedWin[]; start: string; end: string | null; from: string; horizonDays: number }): Occ[] {
  const first = parse(p.start) > parse(p.from) ? p.start : p.from;
  const horizonEnd = addDays(p.from, p.horizonDays);
  const last = p.end && parse(p.end) < parse(horizonEnd) ? p.end : horizonEnd;
  const out: Occ[] = [];
  for (let d = first; parse(d) <= parse(last) && out.length < MAX_OCCURRENCES; d = addDays(d, 1)) {
    const wd = weekdayOf(d);
    for (const w of p.schedule) if (w.weekday === wd && w.endMinute > w.startMinute) out.push({ occursOn: d, startMinute: w.startMinute, endMinute: w.endMinute });
  }
  return out.sort((a, b) => (a.occursOn === b.occursOn ? a.startMinute - b.startMinute : a.occursOn < b.occursOn ? -1 : 1));
}

export type OccState = { occursOn: string; status: "scheduled" | "completed" | "missed" | "cancelled"; confirmed: boolean };
/** What still blocks ending a term: past sessions nobody resolved, and completed sessions the business hasn't confirmed. */
export function termBlockers(occ: OccState[], todayStr: string) {
  const unresolved = occ.filter((o) => o.status === "scheduled" && o.occursOn < todayStr);
  const unconfirmed = occ.filter((o) => o.status === "completed" && !o.confirmed);
  return { unresolved: unresolved.length, unconfirmed: unconfirmed.length, canEnd: unresolved.length === 0 && unconfirmed.length === 0 };
}

export const REMINDER_LEAD_DAYS = 14;
/** Days until the term ends (negative once ended); null for open-ended terms. */
export const daysUntilEnd = (end: string | null, todayStr: string) => (end ? daysBetween(todayStr, end) : null);
export const needsRenewalReminder = (end: string | null, todayStr: string) => { const d = daysUntilEnd(end, todayStr); return d !== null && d >= 0 && d <= REMINDER_LEAD_DAYS; };

export const MAX_RENEWAL_DAYS = 366;
/** Validates a proposed new end date against the current one. Returns an error message or null. */
export function renewalDateError(currentEnd: string | null, proposed: string, todayStr: string): string | null {
  if (!currentEnd) return "This assignment has no end date, so there is nothing to renew";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(proposed)) return "Enter a valid date";
  if (proposed <= currentEnd) return "The new end date must be after the current end date";
  if (daysBetween(currentEnd, proposed) > MAX_RENEWAL_DAYS) return "A renewal can extend the term by at most one year";
  if (currentEnd < todayStr) return "This term has already ended";
  return null;
}

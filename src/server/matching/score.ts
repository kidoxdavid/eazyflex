/**
 * Explainable, rule-weighted matching. Pure functions: no database, no framework.
 * Inputs are plain data; weights/thresholds come from the active (versioned) matching_rules row.
 *
 * Design rules:
 *  - Mandatory requirements (mandatory skills, real availability for required hours, travel radius,
 *    a worker-configured HARD minimum rate) make a worker ineligible — they are never traded off.
 *  - Everything else is a weighted, explainable score. Criteria we cannot assess (missing data) are
 *    excluded from the score and reported as "unknown" — we never claim a perfect match on partial data.
 *  - No protected characteristic (age, parental status, gender, etc.) is an input to this module.
 */

export type Weights = {
  skills: number; availability: number; location: number; arrangement: number;
  compensation: number; experience: number; duration: number; preferences: number;
};
export type Thresholds = { recommend: number; strong: number };
export type Mandatory = ("skills" | "availability" | "location" | "hardMinRate")[];
export type MatchRules = { weights: Weights; thresholds: Thresholds; mandatory?: Mandatory };

export const DEFAULT_RULES: MatchRules = {
  weights: { skills: 30, availability: 25, location: 12, arrangement: 8, compensation: 10, experience: 6, duration: 4, preferences: 5 },
  thresholds: { recommend: 50, strong: 80 },
  mandatory: ["skills", "availability", "location", "hardMinRate"],
};

export type Window = { weekday: number; startMinute: number; endMinute: number };
export type DateRange = { start: string; end: string }; // ISO yyyy-mm-dd inclusive
export const EXPERIENCE_ORDER = ["entry", "intermediate", "experienced", "expert"] as const;

export type MatchOpportunity = {
  arrangement: "remote" | "local" | "hybrid";
  engagementType: string;
  categoryId: string | null;
  payType: "hourly" | "fixed" | "shift" | "recurring";
  payMinCents: number; payMaxCents: number;
  experienceLevel: (typeof EXPERIENCE_ORDER)[number];
  skills: { skillId: string; name?: string; mandatory: boolean }[];
  schedule: Window[];
  startDate: string | null; endDate: string | null;
  hoursPerWeek: number | null;
  area: { lat: number; lng: number; name?: string } | null;
};

export type MatchWorker = {
  arrangements: string[]; engagementTypes: string[]; categoryIds: string[];
  skillIds: string[];
  experienceLevel: (typeof EXPERIENCE_ORDER)[number];
  area: { lat: number; lng: number } | null;
  travelRadiusKm: number;
  availability: Window[];
  unavailability: DateRange[];
  availabilityPaused: boolean;
  maxHoursPerWeek: number | null;
  minAssignmentDays: number | null; maxAssignmentDays: number | null;
  preferredHourlyCents: number | null; minHourlyCents: number | null; minHourlyIsHard: boolean;
  preferredFixedCents: number | null; willingToNegotiate: boolean;
};

export type Criterion = keyof Weights;
export type Reason = { criterion: Criterion; status: "match" | "partial" | "gap" | "unknown" | "blocker"; text: string; score: number | null };
export type MatchResult = {
  eligible: boolean; score: number; /** 0..1 share of the configured weighting that could be assessed */ coverage: number; tier: "strong" | "good" | "partial" | "not_recommended";
  blockers: string[]; reasons: Reason[]; explanation: string;
};

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Minutes of `need` that are covered by the union of `have` windows on the same weekday. */
export function coveredMinutes(need: Window, have: Window[]): number {
  const segs = have.filter((h) => h.weekday === need.weekday)
    .map((h) => [Math.max(h.startMinute, need.startMinute), Math.min(h.endMinute, need.endMinute)] as const)
    .filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  let total = 0, curEnd = -1;
  for (const [s, e] of segs) {
    const start = Math.max(s, curEnd);
    if (e > start) total += e - start;
    curEnd = Math.max(curEnd, e);
  }
  return total;
}

const dayMs = 86400_000;
const parse = (d: string) => Date.parse(d + "T00:00:00Z");
export function daysBetween(start: string, end: string) { return Math.round((parse(end) - parse(start)) / dayMs) + 1; }

/** Share (0..1) of the opportunity's scheduled dates that fall inside the worker's unavailable ranges. */
export function unavailableShare(opp: Pick<MatchOpportunity, "startDate" | "endDate" | "schedule">, un: DateRange[]): number {
  if (!opp.startDate || !un.length) return 0;
  const end = opp.endDate ?? opp.startDate;
  const weekdays = new Set(opp.schedule.map((s) => s.weekday));
  let total = 0, blocked = 0;
  const cap = Math.min(daysBetween(opp.startDate, end), 366);
  for (let i = 0; i < cap; i++) {
    const t = parse(opp.startDate) + i * dayMs;
    const wd = new Date(t).getUTCDay();
    if (weekdays.size && !weekdays.has(wd)) continue;
    total++;
    const iso = new Date(t).toISOString().slice(0, 10);
    if (un.some((r) => iso >= r.start && iso <= r.end)) blocked++;
  }
  return total ? blocked / total : 0;
}

const money = (c: number) => "$" + (c / 100).toFixed(c % 100 ? 2 : 0);

export function scoreMatch(opp: MatchOpportunity, w: MatchWorker, rules: MatchRules = DEFAULT_RULES): MatchResult {
  const mandatory = new Set(rules.mandatory ?? DEFAULT_RULES.mandatory);
  const reasons: Reason[] = [];
  const blockers: string[] = [];
  const add = (r: Reason) => { reasons.push(r); };
  const block = (criterion: Criterion, text: string) => { blockers.push(text); add({ criterion, status: "blocker", text, score: 0 }); };

  // ---- Skills ----
  const have = new Set(w.skillIds);
  if (opp.skills.length) {
    const missingMandatory = opp.skills.filter((s) => s.mandatory && !have.has(s.skillId));
    const matched = opp.skills.filter((s) => have.has(s.skillId));
    const sc = matched.length / opp.skills.length;
    const nm = (s: { name?: string; skillId: string }) => s.name ?? "a required skill";
    if (missingMandatory.length && mandatory.has("skills")) {
      block("skills", `Missing required skill${missingMandatory.length > 1 ? "s" : ""}: ${missingMandatory.map(nm).join(", ")}`);
    } else if (matched.length) {
      add({ criterion: "skills", status: sc === 1 ? "match" : "partial", score: sc,
        text: sc === 1 ? `Matches all ${opp.skills.length} requested skills (${matched.map(nm).join(", ")})` : `Matches ${matched.length} of ${opp.skills.length} requested skills (${matched.map(nm).join(", ")})` });
    } else add({ criterion: "skills", status: "gap", score: 0, text: "None of the requested skills are on your profile" });
  } else add({ criterion: "skills", status: "unknown", score: null, text: "No specific skills were requested" });

  // ---- Availability (real days/hours, not a general preference) ----
  if (w.availabilityPaused) {
    block("availability", "Worker has paused availability");
  } else if (opp.schedule.length) {
    let need = 0, got = 0;
    for (const s of opp.schedule) { need += s.endMinute - s.startMinute; got += coveredMinutes(s, w.availability); }
    let cov = need ? got / need : 1;
    const unShare = unavailableShare(opp, w.unavailability);
    if (cov === 0 && mandatory.has("availability")) block("availability", "Not available during the requested days and hours");
    else if (unShare >= 1 && mandatory.has("availability")) block("availability", "Marked unavailable for the whole requested date range");
    else {
      cov = cov * (1 - unShare);
      const pct = Math.round(cov * 100);
      add({ criterion: "availability", status: cov >= 0.999 ? "match" : "partial", score: cov,
        text: cov >= 0.999 ? "Available for all of the requested hours" : `Available for about ${pct}% of the requested hours${unShare > 0 ? " (some dates marked unavailable)" : ""}` });
      if (opp.hoursPerWeek && w.maxHoursPerWeek && opp.hoursPerWeek > w.maxHoursPerWeek) {
        add({ criterion: "availability", status: "gap", score: 0.3, text: `Needs ${opp.hoursPerWeek} h/week; your maximum is ${w.maxHoursPerWeek} h/week` });
      }
    }
  } else {
    const un = unavailableShare(opp, w.unavailability);
    if (opp.startDate && un > 0) add({ criterion: "availability", status: "partial", score: 1 - un, text: "Some of the project dates overlap time you marked unavailable" });
    else add({ criterion: "availability", status: "unknown", score: null, text: "Flexible schedule — no fixed hours required" });
  }

  // ---- Location ----
  if (opp.arrangement === "remote") {
    add({ criterion: "location", status: "unknown", score: null, text: "Remote — location is not a constraint" });
  } else if (opp.area && w.area) {
    const km = haversineKm(opp.area, w.area);
    if (km <= w.travelRadiusKm) {
      add({ criterion: "location", status: "match", score: 1 - 0.3 * (km / Math.max(w.travelRadiusKm, 1)),
        text: `About ${Math.round(km)} km away — within your ${w.travelRadiusKm} km travel radius` });
    } else if (opp.arrangement === "hybrid") {
      add({ criterion: "location", status: "gap", score: 0.2, text: `About ${Math.round(km)} km away (beyond your ${w.travelRadiusKm} km radius); hybrid work may be partly remote` });
    } else if (mandatory.has("location")) block("location", `About ${Math.round(km)} km away — outside your ${w.travelRadiusKm} km travel radius`);
    else add({ criterion: "location", status: "gap", score: 0, text: `About ${Math.round(km)} km away` });
  } else add({ criterion: "location", status: "unknown", score: null, text: "Location could not be compared — add your service area to your profile" });

  // ---- Work arrangement ----
  if (!w.arrangements.length) add({ criterion: "arrangement", status: "unknown", score: null, text: "No work arrangement preference set" });
  else if (w.arrangements.includes(opp.arrangement)) add({ criterion: "arrangement", status: "match", score: 1, text: `${cap(opp.arrangement)} work is one of your preferences` });
  else if (opp.arrangement === "hybrid" && (w.arrangements.includes("remote") || w.arrangements.includes("local"))) add({ criterion: "arrangement", status: "partial", score: 0.6, text: "Hybrid work mixes remote and on-site time" });
  else add({ criterion: "arrangement", status: "gap", score: 0, text: `This is ${opp.arrangement} work; you prefer ${w.arrangements.join("/")}` });

  // ---- Compensation (only compared like-for-like; never auto-excludes unless a hard minimum is set) ----
  if (opp.payType === "hourly" && (w.preferredHourlyCents || w.minHourlyCents)) {
    const top = opp.payMaxCents;
    if (w.minHourlyCents && top < w.minHourlyCents) {
      if (w.minHourlyIsHard && mandatory.has("hardMinRate")) block("compensation", `Pays up to ${money(top)}/h — below your minimum of ${money(w.minHourlyCents)}/h`);
      else add({ criterion: "compensation", status: "gap", score: w.willingToNegotiate ? 0.4 : 0.15, text: `Pays up to ${money(top)}/h — below your minimum of ${money(w.minHourlyCents)}/h${w.willingToNegotiate ? " (you are open to negotiating)" : ""}` });
    } else if (w.preferredHourlyCents && top >= w.preferredHourlyCents) add({ criterion: "compensation", status: "match", score: 1, text: `Pays ${money(opp.payMinCents)}–${money(top)}/h — meets your preferred rate of ${money(w.preferredHourlyCents)}/h` });
    else add({ criterion: "compensation", status: "partial", score: 0.7, text: `Pays up to ${money(top)}/h — above your minimum but below your preferred rate` });
  } else if (opp.payType === "fixed" && w.preferredFixedCents) {
    if (opp.payMaxCents >= w.preferredFixedCents) add({ criterion: "compensation", status: "match", score: 1, text: `Budget up to ${money(opp.payMaxCents)} meets your preferred project fee` });
    else add({ criterion: "compensation", status: "partial", score: 0.5, text: `Budget up to ${money(opp.payMaxCents)} is below your preferred project fee of ${money(w.preferredFixedCents)}` });
  } else add({ criterion: "compensation", status: "unknown", score: null, text: "Compensation preferences not comparable for this pay type" });

  // ---- Experience ----
  const diff = EXPERIENCE_ORDER.indexOf(w.experienceLevel) - EXPERIENCE_ORDER.indexOf(opp.experienceLevel);
  if (diff >= 0) add({ criterion: "experience", status: "match", score: 1, text: `Your experience level (${w.experienceLevel}) meets the ${opp.experienceLevel} requirement` });
  else if (diff === -1) add({ criterion: "experience", status: "partial", score: 0.5, text: `One level below the ${opp.experienceLevel} experience requested` });
  else add({ criterion: "experience", status: "gap", score: 0, text: `Requested experience (${opp.experienceLevel}) is above your level` });

  // ---- Duration ----
  if (opp.startDate && opp.endDate && (w.minAssignmentDays || w.maxAssignmentDays)) {
    const d = daysBetween(opp.startDate, opp.endDate);
    const ok = (!w.minAssignmentDays || d >= w.minAssignmentDays) && (!w.maxAssignmentDays || d <= w.maxAssignmentDays);
    add({ criterion: "duration", status: ok ? "match" : "gap", score: ok ? 1 : 0.3, text: ok ? `${d}-day engagement fits your preferred duration` : `${d}-day engagement is outside your preferred duration` });
  } else add({ criterion: "duration", status: "unknown", score: null, text: "Duration preference not set or dates not specified" });

  // ---- Preferences (engagement type + category) ----
  const prefParts: number[] = [];
  if (w.engagementTypes.length) prefParts.push(w.engagementTypes.includes(opp.engagementType) ? 1 : 0);
  if (w.categoryIds.length && opp.categoryId) prefParts.push(w.categoryIds.includes(opp.categoryId) ? 1 : 0);
  if (prefParts.length) {
    const sc = prefParts.reduce((a, b) => a + b, 0) / prefParts.length;
    add({ criterion: "preferences", status: sc === 1 ? "match" : sc > 0 ? "partial" : "gap", score: sc,
      text: sc === 1 ? "Matches the kinds of work you said you want" : sc > 0 ? "Partly matches the kinds of work you said you want" : "Outside the kinds of work you said you want" });
  } else add({ criterion: "preferences", status: "unknown", score: null, text: "No work-type preferences set" });

  // ---- Weighted score over assessable criteria only ----
  const best = new Map<Criterion, Reason>();
  for (const r of reasons) {
    const cur = best.get(r.criterion);
    if (!cur || (r.score ?? 2) < (cur.score ?? 2) || r.status === "blocker") best.set(r.criterion, cur?.status === "blocker" ? cur : r);
  }
  let num = 0, den = 0;
  for (const [c, r] of best) { if (r.score === null) continue; const wt = rules.weights[c] ?? 0; num += wt * r.score; den += wt; }
  // Confidence: share of total weight that could actually be assessed. A match judged on little data must not
  // look like a perfect one, so the raw score is scaled between 60% (nothing assessable) and 100% (everything).
  const totalWeight = Object.values(rules.weights).reduce((a, b) => a + b, 0);
  const coverage = totalWeight ? den / totalWeight : 0;
  const score = den ? Math.round((num / den) * (0.6 + 0.4 * coverage) * 100) : 0;

  const eligible = blockers.length === 0;
  const hasGaps = reasons.some((r) => r.status === "gap" || r.status === "partial");
  // "strong" requires that nothing important was left unassessed (skills data present) and no gaps.
  const hasUnknown = reasons.some((r) => r.status === "unknown" && r.criterion === "skills") || coverage < 0.5;
  const tier: MatchResult["tier"] = !eligible || score < rules.thresholds.recommend ? "not_recommended"
    : score >= rules.thresholds.strong && !hasGaps && !hasUnknown ? "strong"
    : score >= rules.thresholds.strong ? "good" : "partial";

  return { eligible, score: eligible ? score : 0, coverage: Math.round(coverage * 100) / 100, tier, blockers, reasons, explanation: explain(eligible, tier, reasons, blockers) };
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function explain(eligible: boolean, tier: MatchResult["tier"], reasons: Reason[], blockers: string[]) {
  if (!eligible) return `Not recommended: ${blockers.join("; ")}.`;
  const pos = reasons.filter((r) => r.status === "match").map((r) => r.text);
  const gaps = reasons.filter((r) => r.status === "gap" || r.status === "partial").map((r) => r.text);
  const unk = reasons.filter((r) => r.status === "unknown" && (r.criterion === "compensation" || (r.criterion === "location" && /could not be compared/.test(r.text)))).map((r) => r.text);
  const lead = tier === "strong" ? "Strong match" : tier === "good" ? "Good match" : tier === "partial" ? "Partial match" : "Weak match";
  return [`${lead}.`, pos.length ? `Why: ${pos.join("; ")}.` : "", gaps.length ? `Things to check: ${gaps.join("; ")}.` : "", unk.length ? `Not assessed: ${unk.join("; ")}.` : ""].filter(Boolean).join(" ");
}

export type BizRole = "owner" | "manager" | "member";
export type BizPerm = "opportunity.write" | "hiring.decide" | "profile.edit" | "verification.submit" | "team.invite" | "team.manage";

/**
 * Business-side roles (separate from platform admin roles).
 *  owner   — everything, including managing the team and verification.
 *  manager — post and edit work, make hiring decisions (applications, offers, assignments, coverage, renewals, reviews),
 *            edit the business profile, and invite *members*.
 *  member  — read-only access plus messaging with people the business already has a relationship with.
 */
const M: Record<BizRole, BizPerm[]> = {
  owner: ["opportunity.write", "hiring.decide", "profile.edit", "verification.submit", "team.invite", "team.manage"],
  manager: ["opportunity.write", "hiring.decide", "profile.edit", "team.invite"],
  member: [],
};
export const canBiz = (role: BizRole | null | undefined, perm: BizPerm) => !!role && M[role].includes(perm);
export const ROLE_LABEL: Record<BizRole, string> = { owner: "Owner", manager: "Manager", member: "Member" };
export const ROLE_SUMMARY: Record<BizRole, string> = {
  owner: "Full control, including team, verification and profile.",
  manager: "Posts work, reviews applicants, hires, manages assignments, coverage and renewals; can invite members.",
  member: "Read-only access to the business’s work, plus messaging.",
};

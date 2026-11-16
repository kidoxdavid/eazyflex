export type AdminRole =
  | "super_admin" | "platform_admin" | "verification_officer" | "support_agent"
  | "finance_admin" | "content_moderator" | "read_only_analyst";

export type Permission =
  | "dashboard.view" | "users.view" | "users.suspend" | "verification.decide"
  | "opportunities.moderate" | "catalog.manage" | "matching.configure"
  | "finance.configure" | "audit.view" | "admins.manage";

const P: Record<AdminRole, Permission[]> = {
  super_admin: ["dashboard.view", "users.view", "users.suspend", "verification.decide", "opportunities.moderate", "catalog.manage", "matching.configure", "finance.configure", "audit.view", "admins.manage"],
  platform_admin: ["dashboard.view", "users.view", "users.suspend", "verification.decide", "opportunities.moderate", "catalog.manage", "matching.configure", "audit.view"],
  verification_officer: ["dashboard.view", "users.view", "verification.decide"],
  support_agent: ["dashboard.view", "users.view"],
  finance_admin: ["dashboard.view", "finance.configure", "audit.view"],
  content_moderator: ["dashboard.view", "opportunities.moderate", "catalog.manage"],
  read_only_analyst: ["dashboard.view", "audit.view"],
};

export const can = (role: AdminRole | null | undefined, perm: Permission) => !!role && P[role].includes(perm);
export const permissionsFor = (role: AdminRole) => P[role];
export const ADMIN_ROLES = Object.keys(P) as AdminRole[];

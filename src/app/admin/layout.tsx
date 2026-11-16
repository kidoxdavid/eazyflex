import { DashboardShell } from "@/components/dashboard";
import { requireUser } from "@/server/auth/session";
import { can, type AdminRole, type Permission } from "@/server/rbac";
export const dynamic = "force-dynamic";
const all: { label: string; href: string; perm: Permission }[] = [
  { label: "Dashboard", href: "/admin", perm: "dashboard.view" }, { label: "Users", href: "/admin/users", perm: "users.view" },
  { label: "Opportunities", href: "/admin/opportunities", perm: "opportunities.moderate" }, { label: "Verification", href: "/admin/verification", perm: "verification.decide" },
  { label: "Categories & skills", href: "/admin/catalog", perm: "catalog.manage" }, { label: "Matching rules", href: "/admin/matching", perm: "matching.configure" }, { label: "Reports", href: "/admin/reports", perm: "reports.review" }, { label: "Audit log", href: "/admin/audit", perm: "audit.view" },
];
export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("admin");
  const nav = all.filter((n) => can(user.adminRole as AdminRole, n.perm));
  return <DashboardShell nav={nav} user={user} area={`Admin · ${user.adminRole?.replace(/_/g, " ")}`}>{children}</DashboardShell>;
}

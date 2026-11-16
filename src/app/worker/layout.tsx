import { DashboardShell } from "@/components/dashboard";
import { requireUser } from "@/server/auth/session";
export const dynamic = "force-dynamic";
const nav = [
  { label: "Overview", href: "/worker" }, { label: "Find Work", href: "/worker/find-work" }, { label: "Recommended for Me", href: "/worker/recommended" },
  { label: "Saved", href: "/worker/saved" }, { label: "My Applications", href: "/worker/applications" }, { label: "My Availability", href: "/worker/availability" }, { label: "My Profile", href: "/worker/profile" },
];
export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("worker");
  return <DashboardShell nav={nav} user={user} area="Worker">{children}</DashboardShell>;
}

import { DashboardShell } from "@/components/dashboard";
import { requireUser } from "@/server/auth/session";
export const dynamic = "force-dynamic";
const nav = [
  { label: "Overview", href: "/worker" }, { label: "Find Work", href: "/worker/find-work" }, { label: "Recommended for Me", href: "/worker/recommended" },
  { label: "Saved", href: "/worker/saved" }, { label: "Saved Searches", href: "/worker/searches" }, { label: "My Applications", href: "/worker/applications" }, { label: "Invitations", href: "/worker/invitations" }, { label: "My Assignments", href: "/worker/assignments" }, { label: "Shift Coverage", href: "/worker/coverage" }, { label: "Messages", href: "/worker/messages" }, { label: "Notifications", href: "/worker/notifications" }, { label: "Settings", href: "/worker/settings" }, { label: "My Availability", href: "/worker/availability" }, { label: "My Profile", href: "/worker/profile" },
];
export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("worker");
  return <DashboardShell nav={nav} user={user} area="Worker">{children}</DashboardShell>;
}

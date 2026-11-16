import { DashboardShell } from "@/components/dashboard";
import { requireUser } from "@/server/auth/session";
export const dynamic = "force-dynamic";
const nav = [{ label: "Overview", href: "/business" }, { label: "Post Work", href: "/business/post" }, { label: "Browse Talent", href: "/business/talent" }, { label: "Shortlist", href: "/business/shortlist" }, { label: "Assignments", href: "/business/assignments" }, { label: "Messages", href: "/business/messages" }, { label: "Notifications", href: "/business/notifications" }, { label: "Business Profile", href: "/business/profile" }];
export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("business");
  return <DashboardShell nav={nav} user={user} area="Business">{children}</DashboardShell>;
}

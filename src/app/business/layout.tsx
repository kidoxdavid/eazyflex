import { DashboardShell } from "@/components/dashboard";
import { requireUser } from "@/server/auth/session";
import { getBusinessForUser } from "@/server/services/business";
import { canBiz } from "@/server/business-rbac";
export const dynamic = "force-dynamic";
const nav = [{ label: "Overview", href: "/business" }, { label: "Post Work", href: "/business/post", perm: "opportunity.write" as const }, { label: "Browse Talent", href: "/business/talent" }, { label: "Shortlist", href: "/business/shortlist" }, { label: "Assignments", href: "/business/assignments" }, { label: "Messages", href: "/business/messages" }, { label: "Notifications", href: "/business/notifications" }, { label: "Team", href: "/business/team" }, { label: "Settings", href: "/business/settings" }, { label: "Business Profile", href: "/business/profile" }];
export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("business");
  const m = await getBusinessForUser(user.id);
  const items = nav.filter((n) => !n.perm || canBiz(m?.role, n.perm));
  return (
    <DashboardShell nav={m ? items : [{ label: "Overview", href: "/business" }]} user={user} area={m ? `Business · ${m.role}` : "Business"}>
      {m ? <>{m.role === "member" && <p role="status" className="mb-5 rounded-xl bg-secondary/60 p-3 text-sm">You have <strong>read-only</strong> access as a member: you can view work, applicants and assignments and message people the business already works with. Ask an owner or manager to make changes.</p>}{children}</> : <div className="rounded-2xl border border-border bg-surface p-6"><h1 className="text-2xl font-semibold">You’re not part of a business</h1><p className="mt-2 text-muted">You may have been removed from a team, or left it. Ask a business owner or manager to send you a new invitation, then open the link in the email.</p></div>}
    </DashboardShell>
  );
}

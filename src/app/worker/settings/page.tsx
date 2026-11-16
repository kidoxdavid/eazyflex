import { requireUser } from "@/server/auth/session";
import { getPrefs } from "@/server/notify";
import { Button, Card, Flash, PageHeader } from "@/components/ui";
import { savePrefsAction } from "@/app/actions/collab";
export const metadata = { title: "Settings" };
const OPTS = [["applications", "emailApplications", "Applications and offers"], ["messages", "emailMessages", "New messages (at most one email per 15 minutes)"], ["assignments", "emailAssignments", "Assignments and submitted work"], ["invitations", "emailInvitations", "Invitations"], ["reviews", "emailReviews", "Reviews"], ["alerts", "emailAlerts", "Saved-search alerts"]] as const;
export default async function Page({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams; const u = await requireUser("worker"); const p = await getPrefs(u.id) as Record<string, boolean>;
  return (<><PageHeader title="Settings" /><Flash error={sp.error} ok={sp.ok} />
    <Card><h2 className="font-sans text-lg font-semibold">Email notifications</h2>
      <p className="mt-1 text-sm text-muted">In-app notifications are always on. Emails never contain message text, and are sent only to verified addresses. Account emails (verification, password reset) are always sent. Push notifications are not available yet.</p>
      <form action={savePrefsAction} className="mt-4 space-y-2">{OPTS.map(([k, col, l]) => <label key={k} className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" name={k} defaultChecked={p[col]} className="size-5" />{l}</label>)}<Button type="submit">Save</Button></form></Card></>);
}

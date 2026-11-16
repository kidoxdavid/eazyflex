import Link from "next/link";
import { getCurrentUser } from "@/server/auth/session";
import { previewInvite } from "@/server/services/team";
import { getBusinessForUser } from "@/server/services/business";
import { Button, Flash, LinkButton } from "@/components/ui";
import { acceptInviteAction } from "@/app/actions/team";
export const metadata = { title: "Join a team", robots: { index: false } };
export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const sp = await searchParams;
  const inv = sp.token ? await previewInvite(sp.token) : null;
  if (!inv) return <><h1 className="text-2xl font-semibold">Invitation not available</h1><p className="mt-3 text-muted">This invitation is invalid, has expired, or was withdrawn. Ask the business to send a new one.</p></>;
  const user = await getCurrentUser();
  const mine = user?.kind === "business" ? await getBusinessForUser(user.id) : null;
  const next = encodeURIComponent(`/join-team?token=${sp.token}`);
  return (<>
    <h1 className="text-2xl font-semibold">Join {inv.businessName}</h1>
    <p className="mt-2 text-muted">You’ve been invited as a <strong>{inv.role}</strong> (invitation for {inv.email}).</p>
    <div className="mt-4"><Flash error={sp.error} /></div>
    {!user ? <div className="space-y-3"><LinkButton href={`/register?type=business&invite=${encodeURIComponent(sp.token!)}`} className="w-full">Create my account</LinkButton><LinkButton variant="outline" href={`/sign-in?next=${next}`} className="w-full">I already have an account</LinkButton><p className="text-xs text-muted">Use {inv.email}. A person can belong to one business.</p></div>
      : user.kind !== "business" ? <p className="text-sm">You’re signed in with a worker or admin account, which can’t join a business team. Sign out and use a business account.</p>
      : user.email.toLowerCase() !== inv.email ? <p className="text-sm">You’re signed in as {user.email}, but this invitation is for {inv.email}. Sign in with that address.</p>
      : mine ? <p className="text-sm">You already belong to a business ({mine.b.name}). A person can belong to one business.</p>
      : <form action={acceptInviteAction}><input type="hidden" name="token" value={sp.token} /><Button type="submit" className="w-full">Accept and join</Button></form>}
    <p className="mt-4 text-sm"><Link href="/" className="underline">Back to the site</Link></p>
  </>);
}

import { requireUser } from "@/server/auth/session";
import { getTeam } from "@/server/services/team";
import { canBiz, ROLE_LABEL, ROLE_SUMMARY, type BizRole } from "@/server/business-rbac";
import { Badge, Button, Card, Field, Flash, Input, PageHeader, Select } from "@/components/ui";
import { changeRoleAction, inviteMemberAction, removeMemberAction, resendInviteAction, revokeInviteAction } from "@/app/actions/team";

export const metadata = { title: "Team" };
export default async function Page({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams; const u = await requireUser("business");
  const t = await getTeam(u.id); const me = t.myRole;
  const canInvite = canBiz(me, "team.invite"), isOwner = canBiz(me, "team.manage");
  return (<>
    <PageHeader title="Team" subtitle={`${t.business.name} · you are ${ROLE_LABEL[me].toLowerCase()}`} />
    <Flash error={sp.error} ok={sp.ok} />
    <Card className="mb-5"><h2 className="font-sans text-lg font-semibold">Roles</h2><ul className="mt-2 space-y-1 text-sm">{(["owner", "manager", "member"] as BizRole[]).map((r) => <li key={r}><strong>{ROLE_LABEL[r]}:</strong> <span className="text-muted">{ROLE_SUMMARY[r]}</span></li>)}</ul></Card>
    <h2 className="mb-3 text-xl font-semibold">Members ({t.members.length})</h2>
    <div className="space-y-2">{t.members.map((m) => { const self = m.userId === u.id;
      return <Card key={m.userId} className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold">{m.name} {self && <span className="text-sm font-normal text-muted">(you)</span>}</p><p className="text-sm text-muted">{m.email}</p></div>
        <div className="flex flex-wrap items-center gap-2"><Badge tone={m.role === "owner" ? "success" : m.role === "manager" ? "info" : "neutral"}>{m.role}</Badge>
          {isOwner && m.role !== "owner" && <form action={changeRoleAction} className="flex gap-1"><input type="hidden" name="userId" value={m.userId} /><Select name="role" defaultValue={m.role} aria-label={`Role for ${m.name}`} className="min-h-9 w-32"><option value="manager">Manager</option><option value="member">Member</option></Select><Button variant="outline" type="submit" className="min-h-9 px-3">Change</Button></form>}
          {m.role !== "owner" && (self || isOwner || (me === "manager" && m.role === "member")) && <form action={removeMemberAction}><input type="hidden" name="userId" value={m.userId} /><Button variant="ghost" type="submit" className="min-h-9 px-3 text-error">{self ? "Leave team" : "Remove"}</Button></form>}</div></Card>; })}</div>
    {canInvite && <><h2 className="mb-3 mt-8 text-xl font-semibold">Invite someone</h2>
      <Card><form action={inviteMemberAction} className="grid items-end gap-3 sm:grid-cols-[2fr_1fr_auto]"><Field label="Email" htmlFor="em" hint="They must use this address to join."><Input id="em" name="email" type="email" required /></Field>
        <Field label="Role" htmlFor="rl"><Select id="rl" name="role" defaultValue="member"><option value="member">Member (read-only)</option>{isOwner && <option value="manager">Manager</option>}</Select></Field><Button type="submit">Send invitation</Button></form>
        <p className="mt-2 text-xs text-muted">The link expires in 7 days. A person can belong to one business; only business accounts can be invited. Invitations are sent through the email system (queued until email delivery is configured).</p></Card></>}
    {t.invites.length > 0 && <><h2 className="mb-3 mt-8 text-xl font-semibold">Pending invitations</h2>
      <div className="space-y-2">{t.invites.map((i) => <Card key={i.id} className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold">{i.email}</p><p className="text-xs text-muted">{i.role} · {i.expired ? "expired" : `expires ${i.expiresAt.toLocaleDateString("en-CA")}`}</p></div>
        {canInvite && (i.role === "member" || isOwner) && <div className="flex gap-2"><form action={resendInviteAction}><input type="hidden" name="id" value={i.id} /><Button variant="outline" type="submit">Resend</Button></form><form action={revokeInviteAction}><input type="hidden" name="id" value={i.id} /><Button variant="ghost" type="submit">Withdraw</Button></form></div>}</Card>)}</div></>}
  </>);
}

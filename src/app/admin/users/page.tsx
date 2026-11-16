import { requireUser, requireAdmin } from "@/server/auth/session";
import { listUsers, type Actor } from "@/server/services/admin";
import { can, type AdminRole } from "@/server/rbac";
import { Badge, Button, Card, Flash, Input, PageHeader, Select } from "@/components/ui";
import { userStatusAction } from "@/app/actions/admin";
import { resetMfaAction } from "@/app/actions/mfa";

export const metadata = { title: "Users" };
export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string; ok?: string; error?: string }> }) {
  const sp = await searchParams;
  await requireAdmin("users.view");
  const u = await requireUser("admin");
  const actor = { id: u.id, kind: u.kind, adminRole: u.adminRole as Actor["adminRole"] };
  const rows = await listUsers(actor, sp.q, sp.kind);
  const canSuspend = can(u.adminRole as AdminRole, "users.suspend");
  return (
    <>
      <PageHeader title="Users" />
      <Flash error={sp.error} ok={sp.ok} />
      <form className="mb-5 flex flex-wrap gap-3" role="search"><Input name="q" placeholder="Search name or email" defaultValue={sp.q} className="max-w-xs" aria-label="Search" /><Select name="kind" defaultValue={sp.kind ?? ""} className="max-w-[180px]" aria-label="Kind"><option value="">All</option><option value="worker">Workers</option><option value="business">Businesses</option><option value="admin">Admins</option></Select><Button type="submit">Filter</Button></form>
      <div className="space-y-3">{rows.map((r) => <Card key={r.id}>
        <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold">{r.fullName} {r.isDemo && <Badge tone="warning">demo</Badge>}</p><p className="text-sm text-muted">{r.email} · {r.kind}{r.adminRole ? ` (${r.adminRole})` : ""} · joined {r.createdAt.toLocaleDateString("en-CA")} · email {r.emailVerifiedAt ? "verified" : "unverified"}</p></div><Badge tone={r.status === "active" ? "success" : "error"}>{r.status}</Badge></div>
        {can(u.adminRole as AdminRole, "admins.manage") && r.kind === "admin" && r.id !== u.id && <form action={resetMfaAction} className="mt-3"><input type="hidden" name="userId" value={r.id} /><Button variant="outline" type="submit">Reset two-factor authentication (lost device)</Button></form>}
        {canSuspend && r.id !== u.id && <form action={userStatusAction} className="mt-3 flex flex-wrap items-end gap-2"><input type="hidden" name="userId" value={r.id} />
          <label className="text-sm font-semibold">Reason (required, logged)<Input name="reason" required className="mt-1 w-72 font-normal" /></label>
          <Select name="status" defaultValue={r.status === "active" ? "suspended" : "active"} className="w-40" aria-label="New status"><option value="active">Reactivate</option><option value="suspended">Suspend</option><option value="restricted">Restrict</option></Select><Button variant="outline" type="submit">Apply</Button></form>}
      </Card>)}</div>
    </>
  );
}

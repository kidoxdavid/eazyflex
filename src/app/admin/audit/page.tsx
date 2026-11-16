import { requireUser, requireAdmin } from "@/server/auth/session";
import { listAudit, type Actor } from "@/server/services/admin";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Audit log" };
export default async function Page() {
  await requireAdmin("audit.view");
  const u = await requireUser("admin");
  const rows = await listAudit({ id: u.id, kind: u.kind, adminRole: u.adminRole as Actor["adminRole"] }, 150);
  return (
    <>
      <PageHeader title="Audit log" subtitle="Append-only. Database triggers block edits and deletions." />
      <div className="overflow-x-auto rounded-xl border border-border bg-surface" tabIndex={0} role="region" aria-label="Audit log table (scrollable)"><table className="w-full text-left text-sm"><thead className="bg-secondary/50"><tr><th className="p-2">Time</th><th className="p-2">Actor</th><th className="p-2">Action</th><th className="p-2">Entity</th></tr></thead>
        <tbody>{rows.map(({ a, actorEmail }) => <tr key={a.id} className="border-t border-border"><td className="p-2 whitespace-nowrap">{a.createdAt.toLocaleString("en-CA")}</td><td className="p-2">{actorEmail ?? "system"}</td><td className="p-2 font-mono text-xs">{a.action}</td><td className="p-2">{a.entityType} {a.entityId?.slice(0, 8)}</td></tr>)}</tbody></table></div>
    </>
  );
}

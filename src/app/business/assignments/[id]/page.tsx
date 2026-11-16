import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getAssignment } from "@/server/services/assignments";
import { AssignmentView } from "@/components/assignment-view";
export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { id } = await params; const sp = await searchParams;
  if (!uuid.test(id)) notFound();
  const u = await requireUser("business");
  const d = await getAssignment(u.id, id).catch(() => null);
  if (!d || d.side !== "business") notFound();
  return <AssignmentView d={d} userId={u.id} sp={sp} />;
}

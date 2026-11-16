import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getConversation } from "@/server/services/messaging";
import { Thread } from "@/components/collab";
import { Flash, PageHeader } from "@/components/ui";
export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { id } = await params; const sp = await searchParams;
  if (!uuid.test(id)) notFound();
  const u = await requireUser("business");
  const conv = await getConversation(u.id, id).catch(() => null);
  if (!conv) notFound();
  return (<><PageHeader title="Conversation" /><Flash error={sp.error} ok={sp.ok} /><Thread conv={conv} userId={u.id} /></>);
}

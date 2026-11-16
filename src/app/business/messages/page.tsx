import { requireUser } from "@/server/auth/session";
import { listConversations } from "@/server/services/messaging";
import { ConversationList } from "@/components/collab";
import { Flash, PageHeader } from "@/components/ui";
export const metadata = { title: "Messages" };
export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams; const u = await requireUser("business");
  return (<><PageHeader title="Messages" /><Flash error={sp.error} /><ConversationList items={await listConversations(u.id)} base="/business/messages" /></>);
}

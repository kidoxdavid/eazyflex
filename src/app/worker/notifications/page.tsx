import { requireUser } from "@/server/auth/session";
import { NotificationList } from "@/components/collab";
import { PageHeader } from "@/components/ui";
export const metadata = { title: "Notifications" };
export default async function Page() { const u = await requireUser("worker"); return (<><PageHeader title="Notifications" /><NotificationList userId={u.id} /></>); }

import { requireUser } from "@/server/auth/session";
import { AccountPanel } from "@/components/account-panel";
export const metadata = { title: "Account" };
export default async function Page({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams; const u = await requireUser("worker");
  return <AccountPanel userId={u.id} email={u.email} sp={sp} />;
}

import { Button, Flash } from "@/components/ui";
import { verifyEmailAction } from "@/app/actions/auth";
export const metadata = { title: "Verify your email", robots: { index: false } };
// Verification is a POST (button) rather than an auto-GET so link scanners/prefetchers cannot consume the token.
export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const sp = await searchParams;
  return (<>
    <h1 className="text-2xl font-semibold">Verify your email</h1>
    <div className="mt-4"><Flash error={sp.error} /></div>
    {sp.token ? <form action={verifyEmailAction} className="space-y-4"><input type="hidden" name="token" value={sp.token} /><p className="text-muted">Confirm that this is your email address.</p><Button type="submit" className="w-full">Confirm my email</Button></form>
      : <p className="text-muted">Open the link in your verification email to continue.</p>}
  </>);
}

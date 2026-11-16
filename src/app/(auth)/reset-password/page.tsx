import { Button, Field, Flash, Input } from "@/components/ui";
import { resetPasswordAction } from "@/app/actions/auth";
export const metadata = { title: "Choose a new password" };
export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const sp = await searchParams;
  return (<>
    <h1 className="text-2xl font-semibold">Choose a new password</h1>
    <div className="mt-4"><Flash error={sp.error} /></div>
    <form action={resetPasswordAction} className="space-y-4"><input type="hidden" name="token" value={sp.token ?? ""} />
      <Field label="New password" htmlFor="password" hint="At least 10 characters, with letters and a number."><Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} /></Field>
      <Button type="submit" className="w-full">Update password</Button></form>
  </>);
}

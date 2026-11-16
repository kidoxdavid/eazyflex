import Link from "next/link";
import { Button, Field, Flash, Input } from "@/components/ui";
import { loginAction } from "@/app/actions/auth";
export const metadata = { title: "Sign in" };
export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; next?: string }> }) {
  const sp = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-semibold">Welcome back</h1>
      <div className="mt-4"><Flash error={sp.error} ok={sp.ok} /></div>
      <form action={loginAction} className="space-y-4">
        <input type="hidden" name="next" value={sp.next ?? ""} />
        <Field label="Email" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
        <Field label="Password" htmlFor="password"><Input id="password" name="password" type="password" autoComplete="current-password" required /></Field>
        <Button type="submit" className="w-full">Sign in</Button>
      </form>
      <p className="mt-4 text-sm"><Link className="underline" href="/forgot-password">Forgot your password?</Link></p>
      <p className="mt-2 text-sm text-muted">New here? <Link className="font-semibold text-primary underline" href="/register?type=worker">I want to earn</Link> or <Link className="font-semibold text-primary underline" href="/register?type=business">I need help with work</Link></p>
    </>
  );
}

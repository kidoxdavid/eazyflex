import Link from "next/link";
import { Button, Field, Flash, Input } from "@/components/ui";
import { forgotPasswordAction } from "@/app/actions/auth";
export const metadata = { title: "Reset password" };
export default async function Page({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const sp = await searchParams;
  return (<>
    <h1 className="text-2xl font-semibold">Reset your password</h1>
    <div className="mt-4"><Flash ok={sp.ok} /></div>
    <form action={forgotPasswordAction} className="space-y-4"><Field label="Email" htmlFor="email"><Input id="email" name="email" type="email" required /></Field><Button type="submit" className="w-full">Send reset link</Button></form>
    <p className="mt-4 text-sm"><Link className="underline" href="/sign-in">Back to sign in</Link></p>
  </>);
}

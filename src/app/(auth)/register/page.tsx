import Link from "next/link";
import { Button, Field, Flash, Input, Select } from "@/components/ui";
import { registerAction } from "@/app/actions/auth";
import { previewInvite } from "@/server/services/team";
export const metadata = { title: "Create your account" };
export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string; type?: string; invite?: string }> }) {
  const sp = await searchParams;
  const invite = sp.invite ? await previewInvite(sp.invite) : null;
  const biz = sp.type === "business" || !!invite;
  return (
    <>
      {invite && <p className="mb-4 rounded-xl bg-secondary p-3 text-sm">You’re joining <strong>{invite.businessName}</strong> as a <strong>{invite.role}</strong>. Use the invited email address.</p>}
      {sp.invite && !invite && <p role="alert" className="mb-4 rounded-xl bg-[#fbe3e1] p-3 text-sm text-error">This invitation is invalid, expired or was withdrawn.</p>}
      <div role="tablist" aria-label="Account type" hidden={!!invite} className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-secondary p-1 text-sm font-semibold">
        <Link role="tab" aria-selected={!biz} href="/register?type=worker" className={`rounded-lg px-3 py-2 text-center ${!biz ? "bg-surface shadow-sm" : ""}`}>I want to earn</Link>
        <Link role="tab" aria-selected={biz} href="/register?type=business" className={`rounded-lg px-3 py-2 text-center ${biz ? "bg-surface shadow-sm" : ""}`}>I need help with work</Link>
      </div>
      <h1 className="text-2xl font-semibold">{biz ? "Create a business account" : "Create your worker account"}</h1>
      <div className="mt-4"><Flash error={sp.error} /></div>
      <form action={registerAction} className="space-y-4">
        <input type="hidden" name="kind" value={biz ? "business" : "worker"} />{invite && <input type="hidden" name="inviteToken" value={sp.invite} />}
        {biz && !invite && <>
          <Field label="Business or household name" htmlFor="businessName"><Input id="businessName" name="businessName" required minLength={2} /></Field>
          <Field label="Account type" htmlFor="businessKind"><Select id="businessKind" name="businessKind"><option value="registered_business">Registered business</option><option value="household">Household / individual</option></Select></Field>
        </>}
        <Field label="Your full name" htmlFor="fullName"><Input id="fullName" name="fullName" autoComplete="name" required /></Field>
        <Field label="Email" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required defaultValue={invite?.email} readOnly={!!invite} /></Field>
        <Field label="Password" htmlFor="password" hint="At least 10 characters, with letters and a number."><Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="City" htmlFor="city"><Input id="city" name="city" autoComplete="address-level2" placeholder="Calgary" /></Field>
          {!biz && <Field label="Postal prefix" htmlFor="pp" hint="First 3 characters only, e.g. T2P"><Input id="pp" name="postalPrefix" maxLength={3} placeholder="T2P" /></Field>}
        </div>
        <Field label="Phone (optional)" htmlFor="phone" hint="Never shown to other users."><Input id="phone" name="phone" type="tel" autoComplete="tel" /></Field>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" name="acceptTerms" required className="mt-1 size-5" /><span>I agree to the <Link className="underline" href="/terms">Terms</Link> and <Link className="underline" href="/privacy">Privacy Policy</Link>.</span></label>
        <Button type="submit" className="w-full">Create account</Button>
      </form>
      <p className="mt-4 text-sm text-muted">Already have an account? <Link className="font-semibold text-primary underline" href="/sign-in">Sign in</Link></p>
    </>
  );
}

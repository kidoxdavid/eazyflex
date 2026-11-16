import { requireUser } from "@/server/auth/session";
import { peekRecoveryCodes, ackRecoveryCodesAction } from "@/app/actions/mfa";
import { Button, LinkButton } from "@/components/ui";
export const metadata = { title: "Recovery codes", robots: { index: false } };
export const dynamic = "force-dynamic";
export default async function Page() {
  await requireUser("admin", { skipMfa: true });
  const codes = await peekRecoveryCodes();
  return (<>
    <h1 className="text-2xl font-semibold">Save your recovery codes</h1>
    {codes ? <>
      <p className="mt-2 text-sm text-muted">Each code works once if you lose your authenticator. <strong>They are shown only until you continue from this page</strong> — store them in a password manager now.</p>
      <ul className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-border bg-surface p-4 font-mono text-sm">{codes.map((c) => <li key={c}>{c}</li>)}</ul></>
      : <p className="mt-2 text-sm text-muted">These codes were already shown and can’t be displayed again. You can generate new ones from the two-factor settings.</p>}
    <div className="mt-6">{codes ? <form action={ackRecoveryCodesAction}><Button type="submit" className="w-full">I’ve saved them — continue</Button></form> : <LinkButton href="/admin" className="w-full">Continue</LinkButton>}</div></>);
}

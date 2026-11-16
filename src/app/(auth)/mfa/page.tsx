import QRCode from "qrcode";
import { redirect } from "next/navigation";
import { requireUser, getSessionContext, mfaEnforced } from "@/server/auth/session";
import { beginEnrollment, mfaStatus } from "@/server/services/mfa";
import { Button, Field, Flash, Input, LinkButton } from "@/components/ui";
import { challengeAction, confirmEnrollmentAction, regenerateCodesAction } from "@/app/actions/mfa";

export const metadata = { title: "Two-factor authentication", robots: { index: false } };
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser("admin", { skipMfa: true });
  const ctx = await getSessionContext(); const st = await mfaStatus(u.id);
  if (st.enrolled && ctx?.mfaVerifiedAt) return (<>
    <h1 className="text-2xl font-semibold">Two-factor authentication</h1><div className="mt-4"><Flash error={sp.error} /></div>
    <p className="text-sm">Enabled. {st.recoveryCodesLeft} unused recovery code{st.recoveryCodesLeft === 1 ? "" : "s"}.</p>
    <form action={regenerateCodesAction} className="mt-4 space-y-3"><Field label="Generate new recovery codes" htmlFor="c" hint="Enter a current 6-digit code. This invalidates your old recovery codes."><Input id="c" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" required /></Field><Button type="submit" variant="outline">Generate new codes</Button></form>
    <div className="mt-4"><LinkButton href="/admin">Back to admin</LinkButton></div></>);
  if (st.enrolled) return (<>
    <h1 className="text-2xl font-semibold">Enter your code</h1><p className="mt-2 text-sm text-muted">Open your authenticator app and enter the 6-digit code, or use a one-time recovery code.</p>
    <div className="mt-4"><Flash error={sp.error} /></div>
    <form action={challengeAction} className="space-y-4"><Field label="Authentication or recovery code" htmlFor="code"><Input id="code" name="code" autoComplete="one-time-code" inputMode="text" required autoFocus /></Field><Button type="submit" className="w-full">Verify</Button></form></>);
  const e = await beginEnrollment(u.id);
  const qr = await QRCode.toDataURL(e.uri, { margin: 1, width: 220 });
  return (<>
    <h1 className="text-2xl font-semibold">Set up two-factor authentication</h1>
    <p className="mt-2 text-sm text-muted">{mfaEnforced() ? "Administrator accounts must use two-factor authentication." : "Recommended for administrator accounts."} Scan the code with an authenticator app (Google Authenticator, 1Password, Authy…), then enter the 6-digit code it shows.</p>
    <div className="mt-4"><Flash error={sp.error} /></div>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={qr} alt="QR code for your authenticator app" width={220} height={220} className="mx-auto rounded-lg border border-border" />
    <p className="mt-3 text-center text-xs text-muted">Can’t scan? Enter this key manually:<br /><code className="break-all font-mono text-sm text-text">{e.secret}</code></p>
    <form action={confirmEnrollmentAction} className="mt-4 space-y-4"><Field label="6-digit code" htmlFor="code"><Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" required /></Field><Button type="submit" className="w-full">Turn on two-factor authentication</Button></form>
    {!mfaEnforced() && <form action={async () => { "use server"; redirect("/admin"); }} className="mt-3"><button className="text-sm underline">Skip for now</button></form>}</>);
}

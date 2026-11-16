import { Button, Card, Field, Flash, Input, PageHeader } from "./ui";
import { deleteAccountAction } from "@/app/actions/collab";
import { deletionBlockers } from "@/server/services/account";

export async function AccountPanel({ userId, email, sp }: { userId: string; email: string; sp: { ok?: string; error?: string } }) {
  const blockers = await deletionBlockers(userId);
  return (<>
    <PageHeader title="Your account and data" subtitle={email} />
    <Flash error={sp.error} ok={sp.ok} />
    <Card className="mb-5"><h2 className="font-sans text-lg font-semibold">Download your data</h2>
      <p className="mt-1 text-sm text-muted">A JSON file with everything you provided or generated here: profile, applications, assignments, your messages, reviews you wrote, preferences and activity. It never includes your password, security tokens, or other people’s personal details. Limit: 3 downloads per day.</p>
      <form action="/account/export" method="post" className="mt-3"><Button type="submit" variant="outline">Download my data (JSON)</Button></form></Card>
    <Card><h2 className="font-sans text-lg font-semibold text-error">Delete your account</h2>
      <p className="mt-1 text-sm text-muted">This can’t be undone. Your profile, preferences, saved items, files and message text are removed, and your name and email are erased. People you worked with keep a record of the engagement (pay, dates, status) that no longer identifies you. Reviews about you are removed; ratings you gave remain without comments. Security audit entries keep only an opaque ID.</p>
      {blockers.length > 0 ? <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-warning">{blockers.map((b) => <li key={b}>{b}</li>)}</ul> : (
        <form action={deleteAccountAction} className="mt-4 grid gap-3 sm:grid-cols-2"><Field label="Your password" htmlFor="dpw"><Input id="dpw" name="password" type="password" autoComplete="current-password" required /></Field>
          <Field label="Type DELETE to confirm" htmlFor="dc"><Input id="dc" name="confirm" autoComplete="off" required pattern="DELETE" /></Field><div><Button type="submit" variant="danger">Permanently delete my account</Button></div></form>)}</Card>
  </>);
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/server/auth/session";
import { getBusinessForUser } from "@/server/services/business";
import { getOpportunityDetail, formatPay, ENGAGEMENT_LABELS } from "@/server/services/opportunities";
import { recommendWorkersForOpportunity } from "@/server/services/matching";
import { BUSINESS_TRANSITIONS, applicationAnswersFor, applicationHistory } from "@/server/services/applications";
import { db } from "@/server/db/client";
import { applications, users } from "@/server/db/schema";
import { inviteAction, shortlistAction } from "@/app/actions/collab";
import { Badge, Button, Card, EmptyState, Field, Flash, LinkButton, PageHeader, Textarea } from "@/components/ui";
import { openConversationAction } from "@/app/actions/collab";
import { applicationNoteAction, applicationStatusAction, opportunityStatusAction } from "@/app/actions/business";

export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LABEL: Record<string, string> = { under_review: "Mark reviewing", shortlisted: "Shortlist", interview_requested: "Request interview", offer_received: "Send offer", declined: "Decline" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { id } = await params; const sp = await searchParams;
  if (!uuid.test(id)) notFound();
  const user = await requireUser("business");
  const m = (await getBusinessForUser(user.id))!;
  const d = await getOpportunityDetail(id);
  if (!d || d.o.businessId !== m.b.id) notFound(); // another business's opportunity looks like it doesn't exist
  const o = d.o;
  const apps = await db.select({ a: applications, name: users.fullName }).from(applications).innerJoin(users, eq(users.id, applications.workerId)).where(eq(applications.opportunityId, id)).orderBy(desc(applications.createdAt));
  const answers = await applicationAnswersFor(apps.map((x) => x.a.id));
  const hist = await Promise.all(apps.map((a) => applicationHistory(a.a.id)));
  const recs = o.status === "published" ? await recommendWorkersForOpportunity(user.id, m.b.id, id, 5) : [];
  return (
    <>
      <PageHeader title={o.title} subtitle={`${ENGAGEMENT_LABELS[o.engagementType]} · ${formatPay(o)}`} action={<div className="flex gap-2"><Badge tone={o.status === "published" ? "success" : o.status === "rejected" ? "error" : "neutral"}>{o.status.replace("_", " ")}</Badge></div>} />
      <Flash error={sp.error} ok={sp.ok} />
      {o.status === "rejected" && <p className="mb-4 rounded-xl bg-[#fbe3e1] p-3 text-sm text-error"><strong>Rejected:</strong> {o.moderationNote} <Link className="underline" href={`/business/post?id=${o.id}`}>Edit and resubmit</Link></p>}
      {o.status === "pending_review" && <p className="mb-4 rounded-xl bg-[#fbebd3] p-3 text-sm text-warning">Awaiting review. It will go live once approved.</p>}
      <div className="mb-6 flex flex-wrap gap-2">
        {["draft", "rejected", "paused"].includes(o.status) && <LinkButton variant="outline" href={`/business/post?id=${o.id}`}>Edit</LinkButton>}
        {o.status === "published" && <LinkButton variant="outline" href={`/opportunities/${o.id}`}>View public page</LinkButton>}
        {d.schedule.length > 0 && ["published", "paused", "filled"].includes(o.status) && <LinkButton variant="secondary" href={`/business/opportunities/${o.id}/coverage`}>Shared coverage</LinkButton>}
        {(o.status === "published" ? ["paused", "closed"] : o.status === "paused" ? ["published", "closed"] : o.status === "filled" ? ["closed"] : []).map((s) => <form key={s} action={opportunityStatusAction}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="status" value={s} /><Button variant="outline" type="submit">{s === "published" ? "Resume" : s === "paused" ? "Pause" : "Close"}</Button></form>)}
      </div>

      <h2 className="mb-3 text-xl font-semibold">Applications ({apps.length})</h2>
      {apps.length === 0 ? <EmptyState title="No applications yet" body="Applications appear here as workers apply." /> : <div className="space-y-4">{apps.map(({ a, name }, i) => { const to = BUSINESS_TRANSITIONS[a.status] ?? [];
        return <Card key={a.id}>
          <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-sans text-lg font-semibold">{name}</h3>{a.matchScore != null && <p className="text-xs text-muted">Match at time of application: {a.matchScore}/100 (informational — not a hiring decision)</p>}</div><Badge tone="info">{a.status.replace(/_/g, " ")}</Badge></div>
          <p className="mt-3 whitespace-pre-line text-sm">{a.proposal}</p>
          {answers.filter((x) => x.applicationId === a.id).map((x) => <div key={x.prompt} className="mt-2 rounded-xl bg-secondary/40 p-3 text-sm"><p className="font-semibold">{x.prompt}</p><p className="whitespace-pre-line text-muted">{x.answer}</p></div>)}
          {a.proposedRateCents && <p className="mt-2 text-sm text-muted">Proposed rate: ${(a.proposedRateCents / 100).toFixed(2)}/h</p>}
          {a.availabilityNote && <p className="mt-1 text-sm text-muted">Availability: {a.availabilityNote}</p>}
          {to.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{to.map((t) => <form key={t} action={applicationStatusAction}><input type="hidden" name="applicationId" value={a.id} /><input type="hidden" name="opportunityId" value={o.id} /><input type="hidden" name="to" value={t} /><Button variant={t === "declined" ? "outline" : "secondary"} type="submit">{LABEL[t]}</Button></form>)}</div>}
          <form action={openConversationAction} className="mt-2"><input type="hidden" name="counterpartId" value={a.workerId} /><input type="hidden" name="opportunityId" value={o.id} /><input type="hidden" name="back" value={`/business/opportunities/${o.id}`} /><Button variant="ghost" type="submit">Message applicant</Button></form>
          <form action={applicationNoteAction} className="mt-3 space-y-2"><input type="hidden" name="applicationId" value={a.id} /><input type="hidden" name="opportunityId" value={o.id} /><Field label="Internal note (never shown to the applicant)" htmlFor={`n${a.id}`}><Textarea id={`n${a.id}`} name="note" rows={2} defaultValue={a.businessNote ?? ""} /></Field><Button variant="ghost" type="submit">Save note</Button></form>
          <details className="mt-2 text-sm"><summary className="cursor-pointer font-semibold">History</summary><ol className="mt-1 text-muted">{hist[i].map((h) => <li key={h.id}>{h.createdAt.toLocaleString("en-CA")} — {h.toStatus.replace(/_/g, " ")}</li>)}</ol></details>
        </Card>; })}</div>}

      {o.status === "published" && <>
        <h2 className="mb-1 mt-10 text-xl font-semibold">Recommended talent</h2>
        <p className="mb-3 text-sm text-muted">Workers who opted in, are available for the requested hours and meet required skills. Explanations come from recorded matching data. You can invite or shortlist; messaging opens once someone applies or accepts.</p>
        {recs.length === 0 ? <p className="text-sm text-muted">No suitable workers found yet.</p> : <div className="space-y-3">{recs.map((r) => <Card key={r.workerId}><div className="flex flex-wrap justify-between gap-2"><div><h3 className="font-sans font-semibold">{r.displayName}</h3><p className="text-sm text-muted">{r.headline}</p></div><Badge tone={r.result.tier === "strong" ? "success" : "info"}>{r.result.score}/100 · {r.result.tier}</Badge></div><p className="mt-2 text-sm">{r.result.explanation}</p><div className="mt-3 flex flex-wrap gap-2"><form action={inviteAction}><input type="hidden" name="workerId" value={r.workerId} /><input type="hidden" name="opportunityId" value={o.id} /><input type="hidden" name="back" value={`/business/opportunities/${o.id}`} /><Button variant="secondary" type="submit">Invite to apply</Button></form><form action={shortlistAction}><input type="hidden" name="workerId" value={r.workerId} /><input type="hidden" name="back" value={`/business/opportunities/${o.id}`} /><Button variant="outline" type="submit">Shortlist</Button></form></div></Card>)}</div>}
      </>}
    </>
  );
}

import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { Badge, Button, Card, Field, Flash, Input, LinkButton, Textarea } from "@/components/ui";
import { ENGAGEMENT_LABELS, PAY_LABELS, formatPay, getOpportunityDetail } from "@/server/services/opportunities";
import { getCurrentUser } from "@/server/auth/session";
import { matchWorkerToOpportunity } from "@/server/services/matching";
import { applyAction } from "@/app/actions/worker";
import { db } from "@/server/db/client";
import { applications, businessMembers } from "@/server/db/schema";
import { and, eq } from "drizzle-orm";
import { duration } from "@/components/opportunity-card";

export const dynamic = "force-dynamic";
const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const d = uuid.test(id) ? await getOpportunityDetail(id) : null;
  if (!d || d.o.status !== "published") return { title: "Opportunity not found", robots: { index: false } };
  return { title: d.o.title, description: d.o.description.slice(0, 155), alternates: { canonical: `/opportunities/${id}` }, openGraph: { title: d.o.title, description: d.o.description.slice(0, 155) } };
}

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { id } = await params; const sp = await searchParams;
  if (!uuid.test(id)) notFound();
  const d = await getOpportunityDetail(id);
  if (!d) notFound();
  const user = await getCurrentUser();
  const isOwner = user?.kind === "business" ? !!(await db.select().from(businessMembers).where(and(eq(businessMembers.userId, user.id), eq(businessMembers.businessId, d.o.businessId))))[0] : false;
  // Unpublished listings are visible only to their business and admins.
  if (d.o.status !== "published" && !isOwner && user?.kind !== "admin") notFound();
  const o = d.o;
  const existing = user?.kind === "worker" ? (await db.select().from(applications).where(and(eq(applications.opportunityId, id), eq(applications.workerId, user.id))))[0] : null;
  const match = user?.kind === "worker" && o.status === "published" ? await matchWorkerToOpportunity(user.id, id).catch(() => null) : null;
  const where = o.arrangement === "remote" ? "Remote" : `${o.arrangement === "hybrid" ? "Hybrid" : "On-site"} — ${d.areaName ?? "area to be confirmed"}${o.locationNote ? ` (${o.locationNote})` : ""}`;

  const jsonLd = o.status === "published" ? {
    "@context": "https://schema.org", "@type": "JobPosting", title: o.title, description: o.description, datePosted: o.publishedAt?.toISOString().slice(0, 10),
    employmentType: o.engagementType === "flexible_shift" ? "PART_TIME" : "CONTRACTOR", hiringOrganization: { "@type": "Organization", name: d.business.name },
    ...(o.arrangement === "remote" ? { jobLocationType: "TELECOMMUTE", applicantLocationRequirements: { "@type": "Country", name: "CA" } } : { jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: d.areaCity ?? "Calgary", addressRegion: "AB", addressCountry: "CA" } } }),
    baseSalary: { "@type": "MonetaryAmount", currency: o.currency, value: { "@type": "QuantitativeValue", minValue: o.payMinCents / 100, maxValue: o.payMaxCents / 100, unitText: o.payType === "hourly" ? "HOUR" : "YEAR" } },
  } : null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      {jsonLd && o.payType === "hourly" && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />}
      <Link href="/opportunities" className="text-sm font-medium text-primary underline">← All opportunities</Link>
      <Flash error={sp.error} ok={sp.ok} />
      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_340px]">
        <article>
          <div className="flex flex-wrap gap-2"><Badge tone="info">{ENGAGEMENT_LABELS[o.engagementType]}</Badge>{o.isDemo && <Badge tone="warning">Demo data</Badge>}{o.status !== "published" && <Badge tone="error">{o.status.replace("_", " ")}</Badge>}</div>
          <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">{o.title}</h1>
          <p className="mt-1 text-muted">{d.business.name} {d.business.verificationStatus === "verified" && <Badge tone="success">✓ Verified business</Badge>}</p>
          <p className="mt-4 font-display text-2xl font-semibold text-primary">{formatPay(o)} <span className="font-sans text-sm font-normal text-muted">({PAY_LABELS[o.payType]})</span></p>
          <h2 className="mt-8 text-xl font-semibold">About the work</h2><p className="mt-2 whitespace-pre-line text-muted">{o.description}</p>
          {o.responsibilities && <><h2 className="mt-6 text-xl font-semibold">Responsibilities</h2><p className="mt-2 whitespace-pre-line text-muted">{o.responsibilities}</p></>}
          {o.deliverables && <><h2 className="mt-6 text-xl font-semibold">Deliverables</h2><p className="mt-2 whitespace-pre-line text-muted">{o.deliverables}</p></>}
          <h2 className="mt-6 text-xl font-semibold">Skills</h2>
          <p className="mt-2 text-muted">{d.skills.length ? d.skills.map((s) => s.name + (s.mandatory ? " (required)" : "")).join(" · ") : "No specific skills listed"}</p>
          {d.schedule.length > 0 && <><h2 className="mt-6 text-xl font-semibold">Schedule</h2><ul className="mt-2 text-muted">{d.schedule.map((s) => <li key={s.id}>{days[s.weekday]} {hhmm(s.startMinute)}–{hhmm(s.endMinute)}</li>)}</ul></>}
          {o.equipment && <><h2 className="mt-6 text-xl font-semibold">Equipment</h2><p className="mt-2 text-muted">{o.equipment}</p></>}
          {o.selectionProcess && <><h2 className="mt-6 text-xl font-semibold">Selection process</h2><p className="mt-2 text-muted">{o.selectionProcess}</p></>}
          {o.cancellationTerms && <><h2 className="mt-6 text-xl font-semibold">Cancellation</h2><p className="mt-2 text-muted">{o.cancellationTerms}</p></>}
          <p className="mt-6 rounded-xl bg-secondary/50 p-3 text-xs text-muted">The platform does not determine whether an engagement is employment or independent contracting. Confirm the working arrangement before you start.</p>
        </article>

        <aside className="space-y-4 lg:sticky lg:top-28 lg:self-start">
          <Card>
            <dl className="space-y-2 text-sm">
              {[["Location", where], ["Duration", duration(o)], ["Workers needed", String(o.workersNeeded)], ["Experience", o.experienceLevel], ["Start", o.startDate ?? "Flexible"], ["End", o.endDate ?? "—"], ["Apply by", o.applicationDeadline ?? "Open until filled"], ...(o.recurring ? [["Recurring", (o.recurrenceNote ?? "Yes") + (o.preferSameWorker ? " · renewal with the same worker preferred" : "")]] : [])].map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="text-right font-semibold">{v}</dd></div>)}
            </dl>
          </Card>

          {match && (
            <Card>
              <h2 className="font-sans text-base font-semibold">How this fits you</h2>
              {match.eligible ? <p className="mt-1 text-sm"><span className="font-display text-2xl font-semibold">{match.score}</span>/100 · <Badge tone={match.tier === "strong" ? "success" : match.tier === "good" ? "info" : "warning"}>{match.tier}</Badge></p> : <p className="mt-1 text-sm font-semibold text-error">Not a fit right now</p>}
              <p className="mt-2 text-sm text-muted">{match.explanation}</p>
              <p className="mt-1 text-xs text-muted">Based on {Math.round(match.coverage * 100)}% of the matching criteria.</p>
              <p className="mt-2 text-xs text-muted">This is guidance only. You can apply regardless, and the business makes every hiring decision.</p>
            </Card>
          )}

          {o.status === "published" && (!user ? (
            <Card><p className="text-sm">Sign in or create a free account to apply.</p><div className="mt-3 flex gap-2"><LinkButton href={`/sign-in?next=/opportunities/${id}`}>Sign in</LinkButton><LinkButton variant="outline" href="/register?type=worker">Create account</LinkButton></div></Card>
          ) : user.kind !== "worker" ? (
            <Card><p className="text-sm text-muted">{isOwner ? "This is your listing." : "Only worker accounts can apply."}</p>{isOwner && <LinkButton className="mt-3" href={`/business/opportunities/${id}`}>Manage</LinkButton>}</Card>
          ) : existing ? (
            <Card><p className="text-sm font-semibold">You applied — status: <Badge tone="info">{existing.status.replace(/_/g, " ")}</Badge></p><LinkButton className="mt-3" variant="outline" href="/worker/applications">View my applications</LinkButton></Card>
          ) : !user.emailVerifiedAt ? (
            <Card><p className="text-sm">Verify your email address to apply. Check your inbox for the link.</p></Card>
          ) : (
            <Card>
              <h2 className="font-sans text-base font-semibold">Apply</h2>
              <form action={applyAction} className="mt-3 space-y-3">
                <input type="hidden" name="opportunityId" value={id} />
                <Field label="Why are you a good fit?" htmlFor="proposal" hint="At least 30 characters. Use your own real experience."><Textarea id="proposal" name="proposal" required minLength={30} /></Field>
                {d.questions.map((q) => <Field key={q.id} label={q.prompt + (q.required ? "" : " (optional)")} htmlFor={`a${q.id}`}><Textarea id={`a${q.id}`} name={`answer_${q.id}`} rows={2} required={q.required} maxLength={2000} /></Field>)}
                {o.payType === "hourly" && <Field label="Your proposed hourly rate ($, optional)" htmlFor="pr"><Input id="pr" name="proposedRate" type="number" step="0.01" min="0" /></Field>}
                <Field label="Availability notes (optional)" htmlFor="an"><Textarea id="an" name="availabilityNote" rows={2} /></Field>
                <Button type="submit" className="w-full">Submit application</Button>
              </form>
            </Card>
          ))}
        </aside>
      </div>
    </div>
  );
}

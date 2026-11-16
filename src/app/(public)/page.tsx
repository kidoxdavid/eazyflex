import Link from "next/link";
import { brand } from "@/lib/brand";
import { Card, LinkButton, Badge } from "@/components/ui";
import { SearchBar } from "@/components/search-bar";
import { OpportunityCard } from "@/components/opportunity-card";
import { getCategories } from "@/server/services/catalog";
import { searchOpportunities } from "@/server/services/opportunities";

export const dynamic = "force-dynamic";

const WAYS = [
  ["Short shifts", "Cover a market stall, an event or a busy weekend on your own schedule."],
  ["Remote projects", "Take on defined projects with clear deliverables and a fixed fee."],
  ["Recurring assignments", "Build steady, repeat work around the hours you actually have."],
  ["Packaged services", "Offer a service you can deliver well and let businesses book it. Coming in a later release."],
];

export default async function Home() {
  const [cats, featured] = await Promise.all([getCategories(), searchOpportunities({ pageSize: 6 })]);
  return (
    <>
      <section className="bg-gradient-to-b from-secondary/70 to-background">
        <div className="mx-auto max-w-6xl px-4 pb-10 pt-14 sm:pt-20">
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight sm:text-6xl">{brand.tagline}</h1>
          <p className="mt-5 max-w-2xl text-lg text-muted">Find flexible work that fits your availability, skills and life. Discover remote projects, local opportunities, short shifts and recurring assignments.</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <LinkButton href="/opportunities" variant="primary" className="px-6 py-3 text-base">Find Flexible Work</LinkButton>
            <LinkButton href="/hire-talent" variant="outline" className="px-6 py-3 text-base">Hire Flexible Talent</LinkButton>
          </div>
          <div className="mt-10"><SearchBar /></div>
          <p className="mt-3 text-sm text-muted">Just want to start? <Link className="font-semibold text-primary underline" href="/register?type=worker">I want to earn</Link> · <Link className="font-semibold text-primary underline" href="/register?type=business">I need help with work</Link></p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14" aria-labelledby="cats">
        <h2 id="cats" className="text-3xl font-semibold">Popular work categories</h2>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cats.map((c) => <Link key={c.id} href={`/work/${c.slug}`} className="rounded-xl border border-border bg-surface p-4 font-semibold hover:border-primary hover:bg-secondary/40">{c.name}<span className="ml-2 text-primary" aria-hidden>→</span></Link>)}
        </div>
      </section>

      <section className="bg-surface py-14" aria-labelledby="how">
        <div className="mx-auto max-w-6xl px-4">
          <h2 id="how" className="text-3xl font-semibold">How it works</h2>
          <div className="mt-6 grid gap-5 md:grid-cols-3">
            {[["1. Tell us when and how you can work", "Set weekly availability, travel distance and pay preferences. Change them any time or pause."], ["2. See work that genuinely fits", "Recommendations are checked against your real days and hours, skills and location — and every one comes with a plain-language reason."], ["3. Apply, agree terms, get the work done", "Businesses post clear scope and pay. You choose whether to apply — never pressured, always in control."]].map(([t, b]) => <Card key={t}><h3 className="text-lg font-semibold">{t}</h3><p className="mt-2 text-muted">{b}</p></Card>)}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14" aria-labelledby="feat">
        <div className="flex items-end justify-between"><h2 id="feat" className="text-3xl font-semibold">Featured opportunities</h2><Link href="/opportunities" className="font-semibold text-primary underline">See all</Link></div>
        {featured.items.length === 0
          ? <p className="mt-6 text-muted">No opportunities are published yet. Check back soon, or <Link className="underline" href="/register?type=business">post the first one</Link>.</p>
          : <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">{featured.items.map((i) => <OpportunityCard key={i.o.id} item={i} />)}</div>}
      </section>

      <section className="bg-primary py-14 text-white" aria-labelledby="why">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 md:grid-cols-2">
          <div><h2 id="why" className="text-3xl font-semibold">Why workers choose {brand.name}</h2>
            <ul className="mt-5 space-y-3 text-white/90">{["Availability is a first-class feature — we match to the days and hours you actually set.", "Pay is always stated up front, and hourly, fixed, shift and recurring pay are never blurred.", "No fee to browse or apply. You decide what to accept.", "Your address, phone and email stay private."].map((t) => <li key={t} className="flex gap-2"><span className="text-accent">✓</span>{t}</li>)}</ul></div>
          <div><h2 className="text-3xl font-semibold">Why businesses choose {brand.name}</h2>
            <ul className="mt-5 space-y-3 text-white/90">{["Find people who are actually available for the hours you need.", "Post micro-tasks, projects, shifts or recurring work in minutes.", "Review applicants with transparent, explainable matching.", "Hire for a few hours without recruiting a permanent employee."].map((t) => <li key={t} className="flex gap-2"><span className="text-accent">✓</span>{t}</li>)}</ul></div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14" aria-labelledby="ways">
        <h2 id="ways" className="text-3xl font-semibold">Different ways to earn</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{WAYS.map(([t, b]) => <Card key={t}><h3 className="font-semibold">{t}</h3><p className="mt-1 text-sm text-muted">{b}</p></Card>)}</div>
        <p className="mt-6 text-sm text-muted">For students, parents returning to work, semi-retired professionals, independent workers — and anyone who wants income that fits their life.</p>
      </section>

      <section id="trust" className="bg-surface py-14" aria-labelledby="trust-h">
        <div className="mx-auto max-w-6xl px-4">
          <h2 id="trust-h" className="text-3xl font-semibold">Trust and safety</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <Card><h3 className="font-semibold">Honest verification</h3><p className="mt-1 text-sm text-muted">Badges appear only for checks that have actually been completed. Nothing is shown as verified until it is.</p></Card>
            <Card><h3 className="font-semibold">Privacy by default</h3><p className="mt-1 text-sm text-muted">Businesses see a first name and initial, skills and availability — not your contact details or home address.</p></Card>
            <Card><h3 className="font-semibold">Human-reviewed</h3><p className="mt-1 text-sm text-muted">Sensitive categories need approval before listing, and all administrator actions are audit-logged.</p></Card>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-14" aria-labelledby="faq">
        <h2 id="faq" className="text-3xl font-semibold">Frequently asked questions</h2>
        <div className="mt-6 divide-y divide-border rounded-2xl border border-border bg-surface">
          {[["Is it free for workers?", "Browsing and applying are free. Any fees are shown to you before you confirm anything."], ["Do I have to be a parent or retired?", `No. ${brand.name} is for anyone who wants flexible work — students, professionals, parents, retirees and independent workers.`], ["Can I work remotely?", "Yes. Opportunities are clearly marked remote, local or hybrid."], ["Are payments live?", "Not yet. Payment processing through a marketplace payment provider is planned and is not active in this release."]].map(([q, a]) => <details key={q} className="group p-4"><summary className="cursor-pointer font-semibold">{q}</summary><p className="mt-2 text-muted">{a}</p></details>)}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4">
        <div className="rounded-3xl bg-secondary p-8 text-center sm:p-12">
          <h2 className="text-3xl font-semibold">Ready to get started?</h2>
          <div className="mt-6 flex flex-wrap justify-center gap-3"><LinkButton href="/register?type=worker">I want to earn</LinkButton><LinkButton href="/register?type=business" variant="outline">I need help with work</LinkButton></div>
          <p className="mt-4"><Badge tone="outline">Launching in {brand.launchCity}</Badge></p>
        </div>
      </section>
    </>
  );
}

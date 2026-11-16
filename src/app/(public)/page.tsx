import Link from "next/link";
import { brand } from "@/lib/brand";
import { Card, LinkButton, Badge, Flash } from "@/components/ui";
import { SearchBar } from "@/components/search-bar";
import { OpportunityCard } from "@/components/opportunity-card";
import { getCategories } from "@/server/services/catalog";
import { searchOpportunities } from "@/server/services/opportunities";

export const dynamic = "force-dynamic";

const WAYS = [
  ["Short shifts", "Cover a market stall, an event or a busy weekend when it suits you."],
  ["Remote projects", "Take on defined projects with clear deliverables and a fixed fee."],
  ["Ongoing work", "Build steady, repeat work around the hours you actually have."],
  ["Packaged services", "Offer a service you can deliver well and let businesses book it. Coming in a later release."],
];

export default async function Home({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const [cats, featured] = await Promise.all([getCategories(), searchOpportunities({ pageSize: 6 })]);
  return (
    <>
      {(sp.ok || sp.error) && <div className="mx-auto max-w-6xl px-4 pt-6"><Flash ok={sp.ok} error={sp.error} /></div>}
      <section className="relative overflow-hidden bg-[radial-gradient(48rem_26rem_at_90%_0%,rgba(163,240,122,.30),transparent_65%),radial-gradient(40rem_24rem_at_0%_30%,rgba(227,239,217,.9),transparent_70%)] pb-14 pt-6 sm:pt-10">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 lg:grid-cols-[1.15fr_1fr]">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-secondary px-4 py-2 text-sm font-bold text-secondary-fg"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-success" />Launching in {brand.launchCity}</p>
            <h1 className="mt-6 text-5xl font-extrabold leading-[1.04] tracking-[-0.04em] text-primary sm:text-6xl">{brand.tagline}</h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">Work that fits around your life: school pick-up, a few mornings a week, or whenever you are free. You choose the hours, we show you work that fits them, and the pay is always clear before you apply.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <LinkButton href="/register?type=worker" variant="primary" className="px-7 py-3.5 text-base">Set my hours</LinkButton>
              <LinkButton href="/opportunities" variant="outline" className="px-7 py-3.5 text-base">Browse work first</LinkButton>
            </div>
            <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold text-primary">
              <li className="flex items-center gap-2"><span aria-hidden="true" className="text-success">✓</span>Free to join and apply</li>
              <li className="flex items-center gap-2"><span aria-hidden="true" className="text-success">✓</span>Your address and phone stay private</li>
              <li className="flex items-center gap-2"><span aria-hidden="true" className="text-success">✓</span>No pressure, ever</li>
            </ul>
            <p className="mt-5 text-sm text-muted">Hiring instead? <Link className="font-bold text-primary underline" href="/hire-talent">Find flexible help</Link> · Questions? <Link className="font-bold text-primary underline" href="/help">Talk to a person</Link></p>
          </div>
          <div className="rounded-[2rem] border border-border bg-surface p-6 shadow-[0_40px_80px_-44px_rgba(20,32,27,.45)]" aria-labelledby="sample-week">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-xs font-extrabold uppercase tracking-widest text-success">Your week</p><h2 id="sample-week" className="mt-1 text-xl font-extrabold text-primary">Work that fits the hours you set</h2></div>
              <span className="rounded-full bg-secondary px-3 py-1 text-xs font-bold text-secondary-fg">Illustration</span>
            </div>
            <div aria-hidden="true" className="mt-5 grid grid-cols-7 gap-2">
              {[["Mon", 55, 0], ["Tue", 75, 1], ["Wed", 30, 0], ["Thu", 65, 1], ["Fri", 45, 0], ["Sat", 25, 0], ["Sun", 0, 0]].map(([d, h, m]) => (
                <div key={d as string} className="rounded-2xl bg-secondary/50 p-2 pb-3">
                  <p className="text-center text-[11px] font-bold text-muted">{d}</p>
                  <div className="relative mt-2 h-28">
                    {(h as number) > 0 && <div className="absolute inset-x-0 top-0 rounded-xl bg-gradient-to-b from-[#a3f07a] to-[#c8f4b0]" style={{ height: `${h}%` }} />}
                    {m === 1 && <div className="absolute inset-x-[-2px] top-[28%] h-[34%] rounded-lg bg-[#6d5bff]" />}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-4 text-sm text-muted">Green is time you are free. Purple is work you have agreed to. You set your own hours after you sign up.</p>
          </div>
        </div>
        <div className="mx-auto mt-12 max-w-6xl px-4"><SearchBar /></div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14" aria-labelledby="fit">
        <h2 id="fit" className="text-3xl font-extrabold">Work that fits your day</h2>
        <p className="mt-2 max-w-2xl text-muted">However your week looks, start from the hours you actually have.</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Around school hours", "Set the hours the children are at school and see only work that fits inside them.", "/register?type=worker"],
            ["A few mornings a week", "Short, regular work that leaves the rest of your week free.", "/opportunities?recurring=1"],
            ["From your kitchen table", "Remote work you can do from home, at your own pace.", "/opportunities?arrangement=remote"],
            ["Your experience counts", "Years of skill are worth something. Take on advice, projects or part-time work on your terms.", "/opportunities?engagementType=specialist_consultation"],
          ].map(([t, b, h]) => (
            <Link key={t} href={h} className="group rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-[0_22px_44px_-34px_rgba(20,32,27,.35)] transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-[0_30px_60px_-32px_rgba(20,32,27,.45)]">
              <h3 className="text-lg font-bold text-primary">{t}</h3><p className="mt-2 text-sm text-muted">{b}</p>
              <span className="mt-3 inline-block text-sm font-bold text-primary" aria-hidden="true">→</span>
            </Link>
          ))}
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
            {[["1. Tell us when and how you can work", "Set weekly availability, travel distance and pay preferences. Change them any time or pause."], ["2. See work that genuinely fits", "Recommendations are checked against your real days and hours, skills and location — and every one comes with a plain-language reason."], ["3. Apply, agree terms, get the work done", "Businesses post clear scope and pay. You choose whether to apply — never pressured, always in control."]].map(([t, b]) => <Card key={t}><h3 className="text-lg font-bold">{t}</h3><p className="mt-2 text-muted">{b}</p></Card>)}
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
            <ul className="mt-5 space-y-3 text-white/90">{["Find people who are actually available for the hours you need.", "Post short tasks, projects, shifts or ongoing work in minutes.", "Review applicants with transparent, explainable matching.", "Hire for a few hours without recruiting a permanent employee."].map((t) => <li key={t} className="flex gap-2"><span className="text-accent">✓</span>{t}</li>)}</ul></div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14" aria-labelledby="ways">
        <h2 id="ways" className="text-3xl font-semibold">Different ways to earn</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{WAYS.map(([t, b]) => <Card key={t}><h3 className="font-semibold">{t}</h3><p className="mt-1 text-sm text-muted">{b}</p></Card>)}</div>
        <p className="mt-6 text-sm text-muted">For anyone who wants income that fits their life: students, people returning to work, people easing out of a career, independent workers and more.</p>
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

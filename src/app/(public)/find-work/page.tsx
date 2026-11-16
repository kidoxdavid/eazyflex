import { LinkButton, Card } from "@/components/ui";
import { SearchBar } from "@/components/search-bar";
export const metadata = { title: "Find flexible work", description: "Remote projects, local shifts and recurring assignments that fit your availability." };
export default function Page() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-14">
      <h1 className="text-4xl font-semibold sm:text-5xl">Find work that fits your life</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted">Tell us when you are free and what you are good at. We show you opportunities that match your real days, hours, skills and distance — with the reason for every recommendation.</p>
      <div className="mt-8"><SearchBar /></div>
      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {[["Set your availability", "Weekly hours, specific dates, time off, a weekly maximum. Pause any time."], ["Choose how you work", "Remote, local or hybrid; micro-tasks, projects, shifts or recurring work."], ["Apply with confidence", "Pay type and amount are always stated. No pressure to accept."]].map(([t, b]) => <Card key={t}><h2 className="text-lg font-semibold">{t}</h2><p className="mt-1 text-muted">{b}</p></Card>)}
      </div>
      <div className="mt-8 flex gap-3"><LinkButton href="/register?type=worker">Create a worker account</LinkButton><LinkButton href="/opportunities" variant="outline">Browse opportunities</LinkButton></div>
    </div>
  );
}

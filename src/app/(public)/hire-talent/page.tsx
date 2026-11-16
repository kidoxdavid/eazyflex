import { LinkButton, Card } from "@/components/ui";
export const metadata = { title: "Hire flexible talent", description: "Post micro-tasks, projects, shifts or recurring work and find people who are actually available." };
export default function Page() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-14">
      <h1 className="text-4xl font-semibold sm:text-5xl">Find the right people. Get the work done.</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted">Post work in minutes, state the pay clearly, and review applicants and recommended talent who are available for the hours you need.</p>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {[["Micro-tasks", "One to five hours of focused help."], ["Fixed projects", "Defined deliverables, deadline and fee."], ["Flexible shifts", "Cover a scheduled period of duties."], ["Recurring assignments", "Weekly or monthly repeat work."], ["Specialist consultations", "Experienced professionals by the hour or project."], ["Local services", "On-site tasks, with only an approximate area published."]].map(([t, b]) => <Card key={t}><h2 className="text-lg font-semibold">{t}</h2><p className="mt-1 text-muted">{b}</p></Card>)}
      </div>
      <p className="mt-8 max-w-2xl rounded-xl bg-secondary/60 p-4 text-sm"><strong>Please note:</strong> the platform does not decide whether a worker is an employee or an independent contractor. That depends on the real working arrangement and applicable law, and should be reviewed for your situation.</p>
      <div className="mt-8"><LinkButton href="/register?type=business">Post work</LinkButton></div>
    </div>
  );
}

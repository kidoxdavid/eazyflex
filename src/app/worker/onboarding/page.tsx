import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { getWorkerBundle, profileCompletion } from "@/server/services/worker";
import { getAreas, getCategories, getSkills } from "@/server/services/catalog";
import { AboutForm, AvailabilityForm, CompensationForm, PreferencesForm } from "@/components/worker-forms";
import { Badge, Button, Card, Flash, LinkButton } from "@/components/ui";
import { completeOnboardingAction } from "@/app/actions/worker";

export const metadata = { title: "Set up your profile" };
const STEPS = ["About you", "Work preferences", "Availability", "Compensation", "Verify & finish"];

export default async function Page({ searchParams }: { searchParams: Promise<{ step?: string; error?: string; ok?: string; welcome?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser("worker");
  const step = Math.min(Math.max(Number(sp.step) || 1, 1), 5);
  const [b, skills, cats, areas, comp] = await Promise.all([getWorkerBundle(user.id), getSkills(), getCategories(), getAreas(), profileCompletion(user.id)]);
  const nav = (s: number) => ({ returnTo: `/worker/onboarding?step=${s + 1}`, failTo: `/worker/onboarding?step=${s}` });
  return (
    <div className="mx-auto max-w-2xl">
      {sp.welcome && <p className="mb-4 rounded-xl bg-secondary p-3 text-sm">Welcome! Your account is created. Let’s set up your profile — it takes a few minutes and you can edit everything later.</p>}
      <ol className="mb-6 flex flex-wrap gap-2" aria-label="Progress">{STEPS.map((s, i) => <li key={s}><Link href={`/worker/onboarding?step=${i + 1}`} aria-current={step === i + 1 ? "step" : undefined} className={`inline-flex min-h-9 items-center rounded-full px-3 text-xs font-semibold ${step === i + 1 ? "bg-accent text-accent-fg" : "bg-white/90 text-secondary-fg"}`}>{i + 1}. {s}</Link></li>)}</ol>
      <Flash error={sp.error} ok={sp.ok} />
      <Card>
        <h1 className="mb-4 text-2xl font-semibold">{STEPS[step - 1]}</h1>
        {step === 1 && <AboutForm b={b} skills={skills} nav={nav(1)} submit="Save and continue" />}
        {step === 2 && <PreferencesForm b={b} cats={cats} areas={areas} nav={nav(2)} submit="Save and continue" />}
        {step === 3 && <AvailabilityForm b={b} nav={nav(3)} submit="Save and continue" />}
        {step === 4 && <CompensationForm b={b} nav={nav(4)} submit="Save and continue" />}
        {step === 5 && (
          <div className="space-y-4">
            <h2 className="font-sans text-base font-semibold">Verification status</h2>
            <ul className="space-y-1 text-sm">{["email", "phone", "identity", "qualification", "reference", "background_check"].map((t) => { const v = b.verifications.find((x) => x.type === t); const st = v?.status ?? "not_started"; return <li key={t} className="flex items-center justify-between rounded-lg border border-border px-3 py-2"><span className="capitalize">{t.replace("_", " ")}</span><Badge tone={st === "verified" ? "success" : st === "rejected" ? "error" : "outline"}>{st.replace("_", " ")}</Badge></li>; })}</ul>
            <p className="text-xs text-muted">Only email verification is available right now. Identity, qualification and other checks will appear here when a verification provider is connected — nothing is shown as verified until it genuinely is.</p>
            <h2 className="font-sans text-base font-semibold">Profile checklist</h2>
            <ul className="space-y-1 text-sm">{comp.items.map((i) => <li key={i.label}>{i.done ? "✅" : i.required ? "⬜ (required)" : "⬜"} {i.label}</li>)}</ul>
            <form action={completeOnboardingAction}><Button type="submit">Finish and see recommendations</Button></form>
            <p className="text-xs text-muted">You can add work history, education and certifications from <Link className="underline" href="/worker/profile">My Profile</Link>.</p>
          </div>
        )}
        {step > 1 && step < 5 && <div className="mt-4"><LinkButton variant="ghost" href={`/worker/onboarding?step=${step - 1}`}>← Back</LinkButton></div>}
      </Card>
    </div>
  );
}

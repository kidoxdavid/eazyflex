import { Card, LinkButton } from "@/components/ui";
export const metadata = { title: "How it works" };
export default function Page() {
  const steps = (title: string, items: string[]) => <Card><h2 className="text-xl font-semibold">{title}</h2><ol className="mt-3 list-decimal space-y-2 pl-5 text-muted">{items.map((i) => <li key={i}>{i}</li>)}</ol></Card>;
  return (
    <div className="mx-auto max-w-5xl px-4 py-14">
      <h1 className="text-4xl font-semibold">How it works</h1>
      <div className="mt-8 grid gap-5 md:grid-cols-2">
        {steps("For workers", ["Create an account and verify your email.", "Add skills, work preferences and weekly availability.", "Browse opportunities or see recommendations with explanations.", "Apply with a short proposal; track every status change.", "Accept an offer if it suits you, then deliver the work and get it approved.", "Leave and receive blind reviews."])}
        {steps("For businesses", ["Create an account and a business profile.", "Post work with clear scope and pay.", "Review applicants and recommended talent.", "Shortlist, interview and send an offer.", "Approve the delivered work and leave a review."])}
      </div>
      <p className="mt-6 text-sm text-muted">Accepted offers become assignments you can track, with in-platform messaging, submissions and blind reviews. Payments are planned for a later release and are not active yet.</p>
      <div className="mt-6"><LinkButton href="/register">Get started</LinkButton></div>
    </div>
  );
}

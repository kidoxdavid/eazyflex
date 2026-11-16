import Link from "next/link";
import { brand } from "@/lib/brand";
import { Card, LinkButton } from "@/components/ui";

export const metadata = { title: "Help and contact", description: "Questions about finding work, setting your hours or hiring? Write to a person." };

const QA: [string, string][] = [
  ["How do I set my hours?", "After you create an account you will be asked when you are free. You can tap a common pattern such as school hours or weekday mornings, or type the times yourself. Change them any time, or pause them if life gets busy."],
  ["Does it cost anything to join or apply?", "No. Joining, browsing and applying are free. Any fee that ever applies will be shown to you before you confirm anything."],
  ["Who can see my address and phone number?", "Nobody. Businesses see a first name and initial, your skills and the hours you are free. Messages stay on the platform, and phone numbers and email addresses are hidden until both sides choose to share them."],
  ["Will I be pressured to say yes?", "No. You choose what to apply for, and a business only hires you if you accept. There are no countdown timers and no penalty for saying no."],
  ["Are payments live?", "Not yet. Payment processing through a payment provider is planned but is not active in this release. Pay is stated on every listing so you know what was offered."],
  ["I have a problem with a business or a message.", "Use the Report button on the listing or message, or write to us below. A person reviews every report."],
];

export default function Page() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14">
      <h1 className="text-4xl font-extrabold sm:text-5xl">Questions? Talk to a person.</h1>
      <p className="mt-4 text-lg text-muted">You do not need to work it all out alone. Write to us and a person will read your message and reply by email.</p>
      <Card className="mt-8">
        <h2 className="font-sans text-xl font-bold">Email us</h2>
        <p className="mt-2 text-muted">Tell us what you are trying to do and what got in the way. You do not need any technical words.</p>
        <p className="mt-4"><a className="text-xl font-extrabold text-primary underline" href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a></p>
        <p className="mt-3 text-sm text-muted">Please do not send passwords or full card or bank details by email. We will never ask for them. Phone support is not available in this release.</p>
      </Card>
      <h2 className="mt-12 text-2xl font-extrabold">Common questions</h2>
      <div className="mt-4 divide-y divide-border rounded-2xl border border-border bg-surface">
        {QA.map(([q, a]) => <details key={q} className="p-4"><summary className="cursor-pointer text-base font-bold">{q}</summary><p className="mt-2 text-muted">{a}</p></details>)}
      </div>
      <div className="mt-10 flex flex-wrap gap-3">
        <LinkButton href="/register?type=worker">Set my hours</LinkButton>
        <LinkButton href="/opportunities" variant="outline">Browse work first</LinkButton>
      </div>
      <p className="mt-6 text-sm text-muted">Hiring instead? See <Link className="underline" href="/hire-talent">how to find flexible help</Link>.</p>
    </div>
  );
}

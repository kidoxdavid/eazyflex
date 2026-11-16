import { requireUser } from "@/server/auth/session";
import { getBusinessForUser } from "@/server/services/business";
import { getAreas } from "@/server/services/catalog";
import { Badge, Button, Card, Field, Flash, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { saveBusinessProfileAction, submitVerificationAction } from "@/app/actions/business";

export const metadata = { title: "Business profile" };
export default async function Page({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser("business");
  const m = (await getBusinessForUser(user.id))!;
  const areas = await getAreas();
  const b = m.b;
  return (
    <>
      <PageHeader title="Business profile" />
      <Flash error={sp.error} ok={sp.ok} />
      <Card className="mb-5">
        <form action={saveBusinessProfileAction} className="grid gap-4 sm:grid-cols-2">
          <Field label="Legal or trading name" htmlFor="name"><Input id="name" name="name" defaultValue={b.name} required /></Field>
          <Field label="Industry" htmlFor="industry"><Input id="industry" name="industry" defaultValue={b.industry ?? ""} /></Field>
          <Field label="Business type" htmlFor="bt"><Input id="bt" name="businessType" defaultValue={b.businessType ?? ""} placeholder="e.g. Corporation, sole proprietor" /></Field>
          <Field label="Size" htmlFor="sb"><Select id="sb" name="sizeBand" defaultValue={b.sizeBand ?? ""}><option value="">Not set</option><option>Just me</option><option>2–10</option><option>11–50</option><option>51–200</option><option>200+</option></Select></Field>
          <Field label="Website" htmlFor="ws"><Input id="ws" name="website" type="url" defaultValue={b.website ?? ""} /></Field>
          <Field label="Contact email (not shown publicly)" htmlFor="ce"><Input id="ce" name="contactEmail" type="email" defaultValue={b.contactEmail ?? ""} /></Field>
          <Field label="City" htmlFor="c"><Input id="c" name="city" defaultValue={b.city ?? ""} /></Field>
          <Field label="Area" htmlFor="a"><Select id="a" name="serviceAreaId" defaultValue={b.serviceAreaId ?? ""}><option value="">Not set</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
          <div className="sm:col-span-2"><Field label="Description" htmlFor="d"><Textarea id="d" name="description" defaultValue={b.description ?? ""} /></Field></div>
          <div><Button type="submit">Save profile</Button></div>
        </form>
      </Card>
      <Card>
        <h2 className="font-sans text-lg font-semibold">Business verification <Badge tone={b.verificationStatus === "verified" ? "success" : b.verificationStatus === "rejected" ? "error" : "outline"}>{b.verificationStatus.replace("_", " ")}</Badge></h2>
        <p className="mt-2 text-sm text-muted">Verified businesses show a badge on their listings after a reviewer has checked the details you provide. No badge is shown until then.</p>
        {["not_started", "rejected", "expired"].includes(b.verificationStatus)
          ? <form action={submitVerificationAction} className="mt-3 space-y-3"><Field label="How can we verify your business?" htmlFor="ev" hint="e.g. Alberta corporate registry number, business website, or a household description. Do not include sensitive ID numbers."><Textarea id="ev" name="evidence" required minLength={10} rows={3} /></Field><Button type="submit">Submit for verification</Button></form>
          : <p className="mt-2 text-sm">{b.verificationStatus === "submitted" ? "Submitted — a reviewer will take a look." : b.verificationStatus === "verified" ? "Your business is verified." : ""}</p>}
      </Card>
    </>
  );
}

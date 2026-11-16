import { requireAdmin } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { categories, skills } from "@/server/db/schema";
import { Badge, Button, Card, Field, Flash, Input, PageHeader, Select } from "@/components/ui";
import { categoryAction, skillAction } from "@/app/actions/admin";
import { asc } from "drizzle-orm";

export const metadata = { title: "Categories & skills" };
export default async function Page({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  await requireAdmin("catalog.manage");
  const [cats, sk] = await Promise.all([db.select().from(categories).orderBy(asc(categories.sortOrder)), db.select().from(skills).orderBy(asc(skills.name))]);
  return (
    <>
      <PageHeader title="Categories & skills" subtitle="Changes apply immediately to onboarding, posting and search." />
      <Flash error={sp.error} ok={sp.ok} />
      <div className="grid gap-5 lg:grid-cols-2">
        <div><h2 className="mb-3 text-xl font-semibold">Categories</h2>
          <div className="space-y-2">{cats.map((c) => <Card key={c.id}><form action={categoryAction} className="flex flex-wrap items-end gap-2"><input type="hidden" name="id" value={c.id} /><Input name="name" defaultValue={c.name} aria-label="Name" className="w-56" />
            <label className="flex min-h-11 items-center gap-1 text-xs"><input type="checkbox" name="requiresApproval" defaultChecked={c.requiresApproval} className="size-4" />needs approval</label>
            <Select name="active" defaultValue={c.active ? "on" : "off"} className="w-28" aria-label="Active"><option value="on">Active</option><option value="off">Hidden</option></Select><Button variant="outline" type="submit">Save</Button></form></Card>)}</div>
          <Card className="mt-3"><form action={categoryAction} className="flex flex-wrap items-end gap-2"><Field label="New category" htmlFor="nc"><Input id="nc" name="name" required /></Field><label className="flex min-h-11 items-center gap-1 text-xs"><input type="checkbox" name="requiresApproval" className="size-4" />needs approval</label><Button type="submit">Add</Button></form></Card></div>
        <div><h2 className="mb-3 text-xl font-semibold">Skills ({sk.length})</h2>
          <Card className="mb-3"><form action={skillAction} className="flex flex-wrap items-end gap-2"><Field label="New skill" htmlFor="ns"><Input id="ns" name="name" required /></Field><Field label="Category" htmlFor="sc"><Select id="sc" name="categoryId"><option value="">None</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field><Button type="submit">Add</Button></form></Card>
          <div className="flex max-h-[32rem] flex-wrap gap-1.5 overflow-y-auto">{sk.map((s) => <Badge key={s.id}>{s.name}</Badge>)}</div></div>
      </div>
    </>
  );
}

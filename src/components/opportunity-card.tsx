import Link from "next/link";
import { Badge, Card } from "./ui";
import { ENGAGEMENT_LABELS, formatPay } from "@/server/services/opportunities";
import { toggleSaveAction } from "@/app/actions/worker";

type Item = {
  o: { id: string; title: string; payType: string; payMinCents: number; payMaxCents: number; arrangement: string; engagementType: string; recurring: boolean; estimatedHours: number | null; hoursPerWeek: number | null; publishedAt: Date | null; isDemo: boolean; featured: boolean; startDate: string | null; endDate: string | null };
  businessName: string; businessVerified: string; areaName?: string | null; areaCity?: string | null; skills: { name: string; mandatory: boolean }[];
};

export function duration(o: Item["o"]) {
  if (o.hoursPerWeek) return `${o.hoursPerWeek} h/week${o.recurring ? ", ongoing" : ""}`;
  if (o.estimatedHours) return `~${o.estimatedHours} hours`;
  if (o.startDate && o.endDate) return `${o.startDate} → ${o.endDate}`;
  return "Duration set by agreement";
}
export const where = (i: Pick<Item, "areaName"> & { o: { arrangement: string } }) => i.o.arrangement === "remote" ? "Remote" : `${i.o.arrangement === "hybrid" ? "Hybrid · " : "On-site · "}${i.areaName ?? "Area to be confirmed"}`;

export function OpportunityCard({ item, saved, back, showSave }: { item: Item; saved?: boolean; back?: string; showSave?: boolean }) {
  const { o } = item;
  const posted = o.publishedAt ? Math.max(0, Math.floor((Date.now() - o.publishedAt.getTime()) / 86400000)) : null;
  return (
    <Card className="flex flex-col gap-3 transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-[0_30px_60px_-30px_rgba(20,32,27,.45)]">
      <div className="flex items-start justify-between gap-3">
        <span aria-hidden="true" className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#a3f07a]/70 to-[#6d5bff]/50 text-sm font-extrabold text-primary">{item.businessName.slice(0, 1).toUpperCase()}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-bold leading-snug"><Link href={`/opportunities/${o.id}`} className="hover:underline">{o.title}</Link></h3>
          <p className="mt-0.5 text-sm text-muted">{item.businessName}{item.businessVerified === "verified" && <span className="ml-2 align-middle"><Badge tone="success">✓ Verified business</Badge></span>}</p>
        </div>
        <div className="flex flex-col items-end gap-1">{o.featured && <Badge tone="warning">Featured</Badge>}{o.isDemo && <Badge tone="outline">Demo</Badge>}</div>
      </div>
      <p className="font-display text-2xl font-extrabold tracking-tight text-primary">{formatPay(o)}</p>
      <div className="flex flex-wrap gap-1.5 text-xs">
        <Badge tone="info">{ENGAGEMENT_LABELS[o.engagementType]}</Badge><Badge>{where({ o, areaName: item.areaName })}</Badge>
        <Badge tone="outline">{duration(o)}</Badge>{o.recurring && <Badge tone="outline">↻ Recurring</Badge>}
      </div>
      {item.skills.length > 0 && <p className="text-sm text-muted"><span className="sr-only">Skills: </span>{item.skills.slice(0, 5).map((s) => s.name + (s.mandatory ? " *" : "")).join(" · ")}</p>}
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <span className="text-xs text-muted">{posted === null ? "" : posted === 0 ? "Posted today" : `Posted ${posted} day${posted > 1 ? "s" : ""} ago`}</span>
        <div className="flex items-center gap-2">
          {showSave && <form action={toggleSaveAction}><input type="hidden" name="opportunityId" value={o.id} /><input type="hidden" name="back" value={back ?? "/worker/saved"} /><button className="min-h-11 rounded-xl px-3 text-sm font-medium text-primary hover:bg-secondary/60" aria-pressed={saved}>{saved ? "★ Saved" : "☆ Save"}</button></form>}
          <Link href={`/opportunities/${o.id}`} className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-bold text-white transition-colors hover:bg-[#16402f]">View &amp; apply</Link>
        </div>
      </div>
    </Card>
  );
}

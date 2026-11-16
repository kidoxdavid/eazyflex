import { brand } from "@/lib/brand";
export const metadata = { title: "Terms" };
export default function Page() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14">
      <h1 className="text-4xl font-semibold">Terms (draft)</h1>
      <p className="mt-4 rounded-xl bg-[#fbebd3] p-4 text-sm text-warning"><strong>Draft placeholder — not legal text.</strong> The terms document must be written and reviewed by qualified counsel (including PIPEDA / Alberta PIPA and Alberta employment, consumer-protection and tax considerations) before launch. Current policy version: {brand.policyVersions.terms}.</p>
    </div>
  );
}

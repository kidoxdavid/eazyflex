import { brand } from "@/lib/brand";
export const metadata = { title: "Privacy" };
export default function Page() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14">
      <h1 className="text-4xl font-semibold">Privacy (draft)</h1>
      <p className="mt-4 rounded-xl bg-[#fbebd3] p-4 text-sm text-warning"><strong>Draft placeholder — not legal text.</strong> The privacy document must be written and reviewed by qualified counsel (including PIPEDA / Alberta PIPA and Alberta employment, consumer-protection and tax considerations) before launch. Current policy version: {brand.policyVersions.privacy}.</p>
    </div>
  );
}

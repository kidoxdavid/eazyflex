import { brand } from "@/lib/brand";
export const metadata = { title: "About" };
export default function Page() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14">
      <h1 className="text-4xl font-semibold">About {brand.name}</h1>
      <p className="mt-4 text-lg text-muted">{brand.name} is a flexible talent marketplace. We believe people should be able to earn around their lives rather than reorganising their lives around conventional employment — and that businesses should be able to find reliable people without committing to a full-time hire.</p>
      <h2 id="trust" className="mt-10 text-2xl font-semibold">Trust and safety</h2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-muted">
        <li>Verification badges are shown only for checks that were actually completed.</li>
        <li>Matching uses skills, availability, location, arrangement and pay — never age, gender, parental status or other protected characteristics.</li>
        <li>Regulated or sensitive work requires approval before it can be listed.</li>
        <li>Administrator access is role-based and every sensitive action is recorded in an append-only audit log.</li>
      </ul>
      <p className="mt-8 text-sm text-muted">{brand.name} is a marketplace platform and does not provide legal, tax or employment advice. We launch first in {brand.launchCity}, {brand.launchRegion}.</p>
    </div>
  );
}

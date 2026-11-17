import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { exportUserData } from "@/server/services/account";
import { audit } from "@/server/audit";

export const dynamic = "force-dynamic";
// POST only (a cross-site page can't trigger it: SameSite=Lax cookies aren't sent on cross-site POSTs).
export async function POST() {
  const u = await getCurrentUser();
  if (!u || u.kind === "admin") return new NextResponse("Not available", { status: 403 });
  try {
    const data = await exportUserData(u.id);
    await audit(u.id, "account.exported", "user", u.id);
    return new NextResponse(JSON.stringify(data, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="eazyflex-data-export.json"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (e: any) { return new NextResponse(e?.message ?? "Failed", { status: e?.code === "rate_limited" ? 429 : 400 }); }
}

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { authoriseDownload, readFile } from "@/server/services/files";

export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user || !uuid.test(id)) return new NextResponse("Not found", { status: 404 });
  try {
    const f = await authoriseDownload({ id: user.id, kind: user.kind, adminRole: user.adminRole }, id);
    const data = await readFile(f.storageKey);
    return new NextResponse(new Uint8Array(data), { headers: {
      "Content-Type": f.mime,
      "Content-Disposition": `attachment; filename="${f.originalName.replace(/[^\w.\- ]/g, "_")}"`, // always download, never render inline
      "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store", "Content-Security-Policy": "sandbox; default-src 'none'",
    } });
  } catch { return new NextResponse("Not found", { status: 404 }); }
}

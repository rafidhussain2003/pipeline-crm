import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rotateApiKey } from "@/lib/api-keys";
import { recordAudit } from "@/lib/audit";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId || session.role !== "admin") {
    return NextResponse.json({ error: "Only company admins can rotate API keys" }, { status: 403 });
  }

  const { id } = await params;
  const rotated = await rotateApiKey(session.companyId, id);
  if (!rotated) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "api_key.rotated",
    entityType: "api_key",
    entityId: id,
    after: { newKeyId: rotated.id, keyPrefix: rotated.keyPrefix },
  });

  return NextResponse.json({ apiKey: rotated });
}

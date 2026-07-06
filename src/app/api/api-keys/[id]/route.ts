import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { revokeApiKey } from "@/lib/api-keys";
import { recordAudit } from "@/lib/audit";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId || session.role !== "admin") {
    return NextResponse.json({ error: "Only company admins can revoke API keys" }, { status: 403 });
  }

  const { id } = await params;
  const revoked = await revokeApiKey(session.companyId, id);
  if (!revoked) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "api_key.revoked",
    entityType: "api_key",
    entityId: id,
  });

  return NextResponse.json({ ok: true });
}

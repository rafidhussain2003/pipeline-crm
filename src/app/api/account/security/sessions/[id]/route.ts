import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { revokeRefreshTokenById } from "@/lib/refresh-tokens";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const revoked = await revokeRefreshTokenById(id, session.userId);
  if (!revoked) return NextResponse.json({ error: "Session not found." }, { status: 404 });

  return NextResponse.json({ ok: true });
}

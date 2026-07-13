import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { emailMessageLabels } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireSuperAdmin } from "@/lib/auth";

// Toggle a label on a message: { labelId, action: "add" | "remove" }.
export async function POST(req: NextRequest, { params }: { params: Promise<{ messageId: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { messageId } = await params;
  const body = await req.json().catch(() => ({}));
  const labelId = typeof body.labelId === "string" ? body.labelId : "";
  const action = body.action === "remove" ? "remove" : "add";
  if (!labelId) return NextResponse.json({ error: "labelId is required" }, { status: 400 });

  if (action === "add") {
    await db.insert(emailMessageLabels).values({ messageId, labelId }).onConflictDoNothing({ target: [emailMessageLabels.messageId, emailMessageLabels.labelId] });
  } else {
    await db.delete(emailMessageLabels).where(and(eq(emailMessageLabels.messageId, messageId), eq(emailMessageLabels.labelId, labelId)));
  }
  return NextResponse.json({ ok: true });
}

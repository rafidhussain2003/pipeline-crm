import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { emailLabels } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireSuperAdmin } from "@/lib/auth";

// Deleting a label removes it everywhere (the message<->label links cascade);
// the messages themselves are untouched.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ labelId: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { labelId } = await params;
  await db.delete(emailLabels).where(eq(emailLabels.id, labelId));
  return NextResponse.json({ ok: true });
}

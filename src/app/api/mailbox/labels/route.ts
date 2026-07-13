import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { emailLabels } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/auth";

export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const labels = await db.select().from(emailLabels).orderBy(emailLabels.name);
  return NextResponse.json({ labels });
}

export async function POST(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Label name is required" }, { status: 400 });
  const color = typeof body.color === "string" ? body.color : "#64748b";
  const [label] = await db
    .insert(emailLabels)
    .values({ name, color })
    .onConflictDoNothing({ target: emailLabels.name })
    .returning();
  if (!label) return NextResponse.json({ error: "A label with that name already exists" }, { status: 409 });
  return NextResponse.json({ label });
}

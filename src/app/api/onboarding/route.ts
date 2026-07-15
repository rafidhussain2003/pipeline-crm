import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

// Phase 13 — first-time setup. GET reports whether onboarding is done + the
// company profile fields the wizard edits. POST saves the company profile
// (step 1) and/or marks onboarding complete. Admin only.
export async function GET() {
  const session = await getSession();
  if (!session?.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [c] = await db.select({ name: companies.name, logoUrl: companies.logoUrl, timezone: companies.timezone, businessHoursStart: companies.businessHoursStart, businessHoursEnd: companies.businessHoursEnd, onboardingCompleted: companies.onboardingCompleted }).from(companies).where(eq(companies.id, session.companyId)).limit(1);
  return NextResponse.json({ company: c });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.companyId || session.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body?.logoUrl === "string") set.logoUrl = body.logoUrl.trim() || null;
  if (typeof body?.timezone === "string" && body.timezone) set.timezone = body.timezone;
  if (Number.isFinite(body?.businessHoursStart)) set.businessHoursStart = Math.floor(body.businessHoursStart);
  if (Number.isFinite(body?.businessHoursEnd)) set.businessHoursEnd = Math.floor(body.businessHoursEnd);
  if (body?.complete === true) set.onboardingCompleted = true;

  await db.update(companies).set(set).where(eq(companies.id, session.companyId));
  if (body?.complete === true) {
    await recordAudit({ companyId: session.companyId, userId: session.userId, action: "company.onboarding_completed", entityType: "company", entityId: session.companyId });
  }
  return NextResponse.json({ ok: true });
}

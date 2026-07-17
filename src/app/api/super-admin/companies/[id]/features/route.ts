import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { requireSuperAdmin } from "@/lib/permissions";
import { FEATURES, featureService } from "@/lib/features";

// Phase 18 — the Platform Owner's per-company feature profile.
// GET returns the full catalog + this company's resolved map; PUT applies a
// patch of { feature: boolean } through featureService (validated, core
// modules protected, each real change audited with owner/company/feature/
// enabled|disabled/timestamp, cache invalidated).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const [company] = await db
    .select({ id: companies.id, name: companies.name, plan: companies.plan, status: companies.status, subscriptionStatus: companies.subscriptionStatus, createdAt: companies.createdAt })
    .from(companies)
    .where(and(eq(companies.id, id), isNull(companies.deletedAt)))
    .limit(1);
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  const enabled = await featureService.getEnabled(id);
  return NextResponse.json({ company, catalog: FEATURES, enabled });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const patch = body?.features;
  if (!patch || typeof patch !== "object") {
    return NextResponse.json({ error: "features must be an object of { feature: boolean }" }, { status: 400 });
  }
  try {
    const enabled = await featureService.setFeatures(id, patch as Record<string, boolean>, { userId: auth.session.userId });
    return NextResponse.json({ enabled });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not update features" }, { status: 400 });
  }
}

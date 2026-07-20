import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { companies, users } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/permissions";
import { and, asc, eq, isNull } from "drizzle-orm";
import { isUuid } from "@/lib/url";
import { recordAudit } from "@/lib/audit";
import { validateCompanyProfile, diffCompanyFields } from "@/lib/companies/profile-validation";
import { checkPolicy } from "@/lib/rate-limit";
import { yearsFromNow, invalidateBillingSnapshot } from "@/lib/billing";

const SUBSCRIPTION_STATUSES = new Set(["trial", "active", "past_due", "cancelled"]);

// Phase 4A — one company for the detail page. Returns the whole row (every
// administrative field already stored) plus the derived owner, so the page
// renders from a single request.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!company || company.deletedAt) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Owner is DERIVED (the company's oldest admin), never a stored column, and
  // is strictly read-only here — Phase 4A does not touch user records.
  const admins = await db
    .select({ name: users.name, email: users.email, createdAt: users.createdAt })
    .from(users)
    .where(and(eq(users.companyId, id), eq(users.role, "admin"), isNull(users.deletedAt)))
    .orderBy(asc(users.createdAt))
    .limit(1);

  return NextResponse.json({ company, owner: admins[0] ?? null });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const rl = checkPolicy("api.admin", session.userId);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
  }
  const { id } = await params;
  const body = await req.json();
  const { status, customDomain, customDomainVerified, plan, subscriptionStatus, freeYears } = body;

  const [beforeRow] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);

  const allowed: Record<string, unknown> = { updatedAt: new Date() };
  if (status) allowed.status = status;
  if (customDomain !== undefined) allowed.customDomain = customDomain;
  if (customDomainVerified !== undefined) allowed.customDomainVerified = customDomainVerified;
  if (plan) allowed.plan = plan;

  // Phase 4A — company profile fields. Deliberately COMPANY-only: nothing here
  // touches users, login emails or credentials. supportEmail is the company's
  // published contact address, not an authentication identity.
  const profile = validateCompanyProfile(body);
  if (!profile.ok) return NextResponse.json({ error: profile.error }, { status: 400 });
  Object.assign(allowed, profile.values);

  // Lets the platform owner activate any already-signed-up company — any
  // plan, including "free" — for however many years, without Stripe. Same
  // mechanism as a comp granted at creation time (see
  // POST /api/super-admin/companies): subscriptionStatus "active" with no
  // real Stripe subscription behind it, and currentPeriodEnd far enough
  // out to cover the grant. isCompExpired() in lib/billing.ts is what
  // makes this expire on its own once that date passes; omitting freeYears
  // (or passing 0) grants access with no expiry at all.
  if (typeof freeYears === "number" && freeYears >= 0) {
    allowed.subscriptionStatus = "active";
    allowed.status = allowed.status ?? "active";
    allowed.trialEndsAt = null;
    allowed.currentPeriodEnd = freeYears > 0 ? yearsFromNow(freeYears) : null;
  } else if (subscriptionStatus) {
    if (!SUBSCRIPTION_STATUSES.has(subscriptionStatus)) {
      return NextResponse.json({ error: "Invalid subscription status." }, { status: 400 });
    }
    allowed.subscriptionStatus = subscriptionStatus;
  }

  const [updated] = await db.update(companies).set(allowed).where(eq(companies.id, id)).returning();
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // This patch can change subscription fields — drop the proxy gate's cached snapshot.
  await invalidateBillingSnapshot(id);

  // Phase 4A — a profile edit is its own audit entry, recording only the fields
  // that actually changed with both old and new values. Kept separate from the
  // status/plan entry below so "the owner renamed this company" is not buried
  // inside a status-change record.
  const PROFILE_KEYS = ["name", "supportEmail", "businessPhone", "address", "website", "timezone"];
  const diff = diffCompanyFields(beforeRow as unknown as Record<string, unknown>, updated as unknown as Record<string, unknown>, PROFILE_KEYS);
  if (diff.changed.length > 0) {
    await recordAudit({
      companyId: id,
      userId: session.userId,
      action: "company.profile_updated",
      entityType: "company",
      entityId: id,
      before: diff.before,
      after: { ...diff.after, changedFields: diff.changed },
    });
  }

  await recordAudit({
    companyId: id,
    userId: session.userId,
    action: "company.status_changed",
    entityType: "company",
    entityId: id,
    before: beforeRow
      ? { status: beforeRow.status, customDomain: beforeRow.customDomain, plan: beforeRow.plan, subscriptionStatus: beforeRow.subscriptionStatus }
      : null,
    after: {
      status: updated.status,
      customDomain: updated.customDomain,
      customDomainVerified: updated.customDomainVerified,
      plan: updated.plan,
      subscriptionStatus: updated.subscriptionStatus,
      currentPeriodEnd: updated.currentPeriodEnd,
    },
  });

  return NextResponse.json({ company: updated });
}

// Soft delete — a suspended/removed company's data stays intact (soft
// delete cascades logically since every child table is filtered by
// companyId + a live parent), recoverable by clearing deletedAt manually if needed.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const rl = checkPolicy("api.super_admin", session.userId);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
  }
  const { id } = await params;

  const [deleted] = await db
    .update(companies)
    .set({ deletedAt: new Date(), status: "suspended" })
    .where(eq(companies.id, id))
    .returning();

  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await recordAudit({
    companyId: id,
    userId: session.userId,
    action: "company.deleted",
    entityType: "company",
    entityId: id,
  });

  return NextResponse.json({ ok: true });
}

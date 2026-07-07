import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { checkPolicy } from "@/lib/rate-limit";

// Profile > Company tab. Read is available to any company member (agents
// can see their company's info, e.g. support email, on their own profile
// page) — only PATCH is admin-gated, per "agents should only edit their
// own profile information."
export async function GET() {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [company] = await db
    .select({
      name: companies.name,
      logoUrl: companies.logoUrl,
      website: companies.website,
      address: companies.address,
      timezone: companies.timezone,
      supportEmail: companies.supportEmail,
      businessPhone: companies.businessPhone,
    })
    .from(companies)
    .where(eq(companies.id, session.companyId))
    .limit(1);

  if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ company });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function PATCH(req: NextRequest) {
  const auth = await requirePermission("company_settings:edit");
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const rl = checkPolicy("api.admin", session.userId);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
  }

  const body = await req.json();

  if ("name" in body && (typeof body.name !== "string" || !body.name.trim())) {
    return NextResponse.json({ error: "Company name cannot be empty." }, { status: 400 });
  }
  if ("supportEmail" in body && body.supportEmail && !EMAIL_RE.test(body.supportEmail)) {
    return NextResponse.json({ error: "Support email is not a valid email address." }, { status: 400 });
  }

  const allowed: Record<string, unknown> = {};
  for (const key of ["name", "logoUrl", "website", "address", "timezone", "supportEmail", "businessPhone"]) {
    if (key in body) allowed[key] = body[key] || null;
  }
  if (Object.keys(allowed).length === 0) {
    return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  }
  allowed.updatedAt = new Date();

  const [beforeRow] = await db.select().from(companies).where(eq(companies.id, session.companyId)).limit(1);

  const [updated] = await db
    .update(companies)
    .set(allowed)
    .where(eq(companies.id, session.companyId))
    .returning();

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "company_settings.updated",
    entityType: "company",
    entityId: session.companyId,
    before: beforeRow
      ? {
          name: beforeRow.name,
          logoUrl: beforeRow.logoUrl,
          website: beforeRow.website,
          address: beforeRow.address,
          timezone: beforeRow.timezone,
          supportEmail: beforeRow.supportEmail,
          businessPhone: beforeRow.businessPhone,
        }
      : null,
    after: {
      name: updated.name,
      logoUrl: updated.logoUrl,
      website: updated.website,
      address: updated.address,
      timezone: updated.timezone,
      supportEmail: updated.supportEmail,
      businessPhone: updated.businessPhone,
    },
  });

  return NextResponse.json({
    company: {
      name: updated.name,
      logoUrl: updated.logoUrl,
      website: updated.website,
      address: updated.address,
      timezone: updated.timezone,
      supportEmail: updated.supportEmail,
      businessPhone: updated.businessPhone,
    },
  });
}

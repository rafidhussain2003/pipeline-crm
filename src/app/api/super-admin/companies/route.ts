import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { companies, users, dispositionOptions, assignmentRules, automationSettings } from "@/db/schema";
import { getSession, hashPassword } from "@/lib/auth";
import { isNull } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";

function requireSuperAdmin(session: Awaited<ReturnType<typeof getSession>>) {
  return session && session.role === "super_admin";
}

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") + "-" + Math.random().toString(36).slice(2, 6)
  );
}

export async function GET() {
  const session = await getSession();
  if (!requireSuperAdmin(session)) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const rows = await db.select().from(companies).where(isNull(companies.deletedAt));
  return NextResponse.json({ companies: rows });
}

// Super-admin can add a company directly, bypassing public signup (e.g. for
// sales-assisted onboarding), and it creates the admin login for that company too.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!requireSuperAdmin(session)) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { companyName, plan, adminName, adminEmail, adminPassword } = await req.json();
  if (!companyName || !adminName || !adminEmail || !adminPassword) {
    return NextResponse.json({ error: "companyName, adminName, adminEmail, adminPassword are required" }, { status: 400 });
  }

  const [company] = await db
    .insert(companies)
    .values({
      name: companyName,
      slug: slugify(companyName),
      status: "active", // super-admin-created companies go live immediately
      plan: plan || "starter",
    })
    .returning();

  const passwordHash = await hashPassword(adminPassword);
  await db.insert(users).values({
    companyId: company.id,
    name: adminName,
    email: adminEmail,
    passwordHash,
    role: "admin",
    tier: "1",
    active: true,
  });

  await db.insert(dispositionOptions).values([
    { companyId: company.id, label: "New Lead", color: "#2563eb", sortOrder: 0 },
    { companyId: company.id, label: "Answering Machine", color: "#d97706", sortOrder: 1 },
    { companyId: company.id, label: "Not Interested", color: "#dc2626", sortOrder: 2 },
    { companyId: company.id, label: "Qualified", color: "#16a34a", sortOrder: 3 },
    { companyId: company.id, label: "Sold", color: "#7c3aed", sortOrder: 4 },
  ]);
  await db.insert(assignmentRules).values([
    { companyId: company.id, tier: "1", weight: 3, active: true },
    { companyId: company.id, tier: "2", weight: 2, active: true },
    { companyId: company.id, tier: "3", weight: 1, active: true },
  ]);
  await db.insert(automationSettings).values({
    companyId: company.id,
    autoAssignEnabled: true,
    assignmentMode: "weighted",
    autoRecycleEnabled: false,
    recycleAfterMinutes: 1440,
  });

  await recordAudit({
    companyId: company.id,
    userId: session!.userId,
    action: "company.created_by_super_admin",
    entityType: "company",
    entityId: company.id,
  });

  return NextResponse.json({ company });
}

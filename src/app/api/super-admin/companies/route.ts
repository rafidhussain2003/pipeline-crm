import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db } from "@/db";
import { companies, users, dispositionOptions, assignmentRules, automationSettings } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { requireSuperAdmin } from "@/lib/permissions";
import { isNull } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { checkPolicy } from "@/lib/rate-limit";
import { yearsFromNow } from "@/lib/billing";

const schema = z.object({
  companyName: z.string().min(1),
  plan: z.string().optional(),
  adminName: z.string().min(1),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8),
  // Grants complimentary access immediately (any plan, including "free")
  // instead of the normal 7-day trial — see isCompExpired() in
  // lib/billing.ts. Omitted or 0 preserves today's default trial behavior
  // exactly. Capped well above any realistic grant just to keep the stored
  // date sane, not because 100 years is a real use case.
  freeYears: z.number().min(0).max(100).optional(),
});

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
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const rows = await db.select().from(companies).where(isNull(companies.deletedAt));
  return NextResponse.json({ companies: rows });
}

// Super-admin can add a company directly, bypassing public signup (e.g. for
// sales-assisted onboarding), and it creates the admin login for that company too.
export async function POST(req: NextRequest) {
  const reqId = randomUUID();
  const log = (step: string, extra?: Record<string, unknown>) =>
    console.log(`[super-admin-create-company:${reqId}] ${step}`, extra ? JSON.stringify(extra) : "");

  try {
    const auth = await requireSuperAdmin();
    if (!auth.ok) return auth.response;
    const { session } = auth;

    // Super-admin actions have the largest blast radius in the app
    // (creating/activating arbitrary companies), so this uses the
    // strictest policy of anything in the app: 10/min per super-admin user.
    const rl = checkPolicy("api.super_admin", session.userId);
    if (!rl.allowed) {
      log("rate_limited");
      return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      log("invalid_json_body");
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { companyName, plan, adminName, adminEmail, adminPassword, freeYears } = parsed.data;
    log("validated", { adminEmail, plan, freeYears });

    const passwordHash = await hashPassword(adminPassword);
    log("password_hashed");

    const now = new Date();
    const isComp = !!freeYears && freeYears > 0;
    const company = await db.transaction(async (tx) => {
      const [company] = await tx
        .insert(companies)
        .values({
          name: companyName,
          slug: slugify(companyName),
          status: "active", // super-admin-created companies go live immediately
          plan: plan || (isComp ? "free" : "starter"),
          // A super-admin-granted comp skips the trial entirely and goes
          // straight to "active" with no real Stripe subscription behind
          // it — see isCompExpired() in lib/billing.ts. Every other
          // company still gets the same 7-day trial regardless of how it
          // was created.
          subscriptionStatus: isComp ? "active" : "trial",
          trialStartedAt: now,
          trialEndsAt: isComp ? null : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
          currentPeriodEnd: isComp ? yearsFromNow(freeYears) : null,
        })
        .returning();
      log("company_created", { companyId: company.id });

      await tx.insert(users).values({
        companyId: company.id,
        name: adminName,
        email: adminEmail,
        passwordHash,
        role: "admin",
        tier: "1",
        active: true,
      });
      log("admin_user_created", { companyId: company.id });

      await tx.insert(dispositionOptions).values([
        { companyId: company.id, label: "New Lead", color: "#2563eb", sortOrder: 0 },
        { companyId: company.id, label: "Answering Machine", color: "#d97706", sortOrder: 1 },
        { companyId: company.id, label: "Not Interested", color: "#dc2626", sortOrder: 2 },
        { companyId: company.id, label: "Qualified", color: "#16a34a", sortOrder: 3 },
        { companyId: company.id, label: "Sold", color: "#7c3aed", sortOrder: 4 },
      ]);
      await tx.insert(assignmentRules).values([
        { companyId: company.id, tier: "1", weight: 3, active: true },
        { companyId: company.id, tier: "2", weight: 2, active: true },
        { companyId: company.id, tier: "3", weight: 1, active: true },
      ]);
      await tx.insert(automationSettings).values({
        companyId: company.id,
        autoAssignEnabled: true,
        assignmentMode: "weighted",
        autoRecycleEnabled: false,
        recycleAfterMinutes: 1440,
      });
      log("defaults_seeded", { companyId: company.id });

      return company;
    });

    log("transaction_committed", { companyId: company.id });

    await recordAudit({
      companyId: company.id,
      userId: session.userId,
      action: "company.created_by_super_admin",
      entityType: "company",
      entityId: company.id,
      after: {
        name: company.name,
        plan: company.plan,
        status: company.status,
        subscriptionStatus: company.subscriptionStatus,
        freeYears: isComp ? freeYears : null,
      },
    });

    log("done", { companyId: company.id });
    return NextResponse.json({ company });
  } catch (err) {
    console.error(`[super-admin-create-company:${reqId}] failed`, err);
    return NextResponse.json(
      { error: "Something went wrong while creating the company. Please try again." },
      { status: 500 }
    );
  }
}

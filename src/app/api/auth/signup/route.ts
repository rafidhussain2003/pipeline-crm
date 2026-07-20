import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { db } from "@/db";
import { companies, dispositionOptions, assignmentRules, automationSettings, users } from "@/db/schema";
import { hashPassword, setSessionCookie, setRefreshCookie } from "@/lib/auth";
import { issueRefreshToken } from "@/lib/refresh-tokens";
import { recordAudit } from "@/lib/audit";
import { checkPolicy, getClientIp } from "@/lib/rate-limit";
import { DEFAULT_DISPOSITIONS } from "@/lib/dispositions/taxonomy";
import { eq } from "drizzle-orm";

const schema = z.object({
  companyName: z.string().min(2),
  plan: z.enum(["starter", "growth", "scale"]).default("starter"),
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
});

const PLAN_PRICE_CENTS: Record<string, number> = {
  starter: 1900,
  growth: 1500,
  scale: 1200,
};

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") + "-" + Math.random().toString(36).slice(2, 6)
  );
}

export async function POST(req: NextRequest) {
  const reqId = randomUUID();
  const log = (step: string, extra?: Record<string, unknown>) =>
    console.log(`[signup:${reqId}] ${step}`, extra ? JSON.stringify(extra) : "");

  try {
    log("start");

    const ip = getClientIp(req);
    const rl = checkPolicy("auth.signup", ip);
    if (!rl.allowed) {
      log("rate_limited", { ip });
      return NextResponse.json({ error: "Too many signup attempts. Please wait a minute and try again." }, { status: 429 });
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
      log("validation_failed", { issues: parsed.error.flatten() });
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { companyName, plan, name, email, password } = parsed.data;
    log("validated", { email, plan });

    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
      log("duplicate_email", { email });
      return NextResponse.json({ error: "An account with that email already exists." }, { status: 409 });
    }
    log("email_available");

    const passwordHash = await hashPassword(password);
    log("password_hashed");

    // Company, admin user, and default company data are created atomically —
    // if any insert fails, nothing is left half-created.
    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const { company, admin } = await db.transaction(async (tx) => {
      const [company] = await tx
        .insert(companies)
        .values({
          name: companyName,
          slug: slugify(companyName),
          status: "pending", // super-admin approves before it goes live (manual-billing phase)
          plan,
          pricePerAgentCents: PLAN_PRICE_CENTS[plan] ?? 1900,
          // Every new company gets a 7-day free trial, independent of the
          // "pending" platform-approval status above — see
          // subscriptionStatusEnum in schema.ts for why these are separate.
          subscriptionStatus: "trial",
          trialStartedAt: now,
          trialEndsAt,
        })
        .returning();
      log("company_created", { companyId: company.id });

      const [admin] = await tx
        .insert(users)
        .values({
          companyId: company.id,
          name,
          email,
          passwordHash,
          role: "admin",
          tier: "1",
          active: true,
        })
        .returning();
      log("admin_user_created", { userId: admin.id, companyId: company.id });

      // Seed sensible defaults so a new company isn't empty on first login.
      // The enterprise disposition taxonomy (lib/dispositions/taxonomy.ts) —
      // the same set migration 0037 backfilled to pre-existing companies.
      await tx.insert(dispositionOptions).values(
        DEFAULT_DISPOSITIONS.map((d) => ({
          companyId: company.id,
          label: d.label,
          color: d.color,
          sortOrder: d.sortOrder,
          category: d.category,
        }))
      );
      log("disposition_options_seeded", { companyId: company.id });

      await tx.insert(assignmentRules).values([
        { companyId: company.id, tier: "1", weight: 3, active: true },
        { companyId: company.id, tier: "2", weight: 2, active: true },
        { companyId: company.id, tier: "3", weight: 1, active: true },
      ]);
      log("assignment_rules_seeded", { companyId: company.id });

      await tx.insert(automationSettings).values({
        companyId: company.id,
        autoAssignEnabled: true,
        assignmentMode: "weighted",
        autoRecycleEnabled: false,
        recycleAfterMinutes: 1440,
      });
      log("automation_settings_seeded", { companyId: company.id });

      return { company, admin };
    });

    log("transaction_committed", { companyId: company.id, userId: admin.id });

    await setSessionCookie({
      userId: admin.id,
      companyId: company.id,
      role: "admin",
      email: admin.email,
    });
    log("session_cookie_set", { userId: admin.id });

    const { rawToken, expiresAt } = await issueRefreshToken(admin.id, req.headers.get("user-agent") || undefined);
    await setRefreshCookie(rawToken, expiresAt);
    log("refresh_token_issued", { userId: admin.id, expiresAt: expiresAt.toISOString() });

    await recordAudit({
      companyId: company.id,
      userId: admin.id,
      action: "company.signed_up",
      entityType: "company",
      entityId: company.id,
      metadata: { plan },
    });
    log("audit_recorded", { companyId: company.id });

    log("done", { companyId: company.id, userId: admin.id });
    return NextResponse.json({
      company,
      message:
        "Account created. Your company is pending activation — our team will review and activate it shortly.",
    });
  } catch (err) {
    console.error(`[signup:${reqId}] failed`, err);
    return NextResponse.json(
      { error: "Something went wrong while creating your account. Please try again." },
      { status: 500 }
    );
  }
}

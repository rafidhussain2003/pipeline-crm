import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db } from "@/db";
import { companies, users, dispositionOptions, assignmentRules, automationSettings } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { requireSuperAdmin } from "@/lib/permissions";
import { and, asc, count, desc, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { checkPolicy } from "@/lib/rate-limit";
import { yearsFromNow } from "@/lib/billing";
import { DEFAULT_DISPOSITIONS } from "@/lib/dispositions/taxonomy";

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

// Phase 4A — Company Management list.
//
// Extended in place rather than adding a second endpoint: the existing
// super-admin dashboard already consumes `companies`, and that key still
// returns the same rows in the same shape. Search/sort/pagination are opt-in
// query params, so a caller that passes none gets the previous behaviour.
const SORTABLE = {
  name: companies.name,
  status: companies.status,
  plan: companies.plan,
  createdAt: companies.createdAt,
  updatedAt: companies.updatedAt,
} as const;

export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const search = sp.get("search")?.trim();
  const sortKey = (sp.get("sort") ?? "createdAt") as keyof typeof SORTABLE;
  const sortCol = SORTABLE[sortKey] ?? companies.createdAt;
  const dir = sp.get("dir") === "asc" ? asc : desc;
  const page = Math.max(1, parseInt(sp.get("page") || "1", 10));
  // Same allow-list discipline as the leads list: an arbitrary page size would
  // let one request pull every tenant into memory.
  const ALLOWED = [25, 50, 100];
  const requested = parseInt(sp.get("pageSize") || "25", 10);
  const pageSize = ALLOWED.includes(requested) ? requested : 25;

  const conditions = [isNull(companies.deletedAt)];
  if (search) {
    const like = `%${search}%`;
    const cond = or(
      ilike(companies.name, like),
      ilike(companies.supportEmail, like),
      ilike(companies.businessPhone, like)
    );
    if (cond) conditions.push(cond);
  }

  const rows = await db
    .select()
    .from(companies)
    .where(and(...conditions))
    // id as tiebreaker: two companies sharing a name or created_at would
    // otherwise have no defined order, which under LIMIT/OFFSET silently
    // repeats one row on a page and drops another.
    .orderBy(dir(sortCol), desc(companies.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const [{ total }] = await db.select({ total: count() }).from(companies).where(and(...conditions));

  // Company Owner is DERIVED — it is the company's admin user, not a column.
  // Fetched as ONE grouped query over just the companies on this page rather
  // than per row, so the list stays a fixed two queries however many tenants
  // exist (Task 7 of the previous phase's performance rule, same discipline).
  const ids = rows.map((r) => r.id);
  const owners = ids.length
    ? await db
        .select({ companyId: users.companyId, name: users.name, email: users.email, createdAt: users.createdAt })
        .from(users)
        .where(and(inArray(users.companyId, ids), eq(users.role, "admin"), isNull(users.deletedAt)))
    : [];
  // Oldest admin wins — that is the account created with the company.
  const ownerByCompany = new Map<string, { name: string; email: string }>();
  for (const o of [...owners].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    if (o.companyId && !ownerByCompany.has(o.companyId)) ownerByCompany.set(o.companyId, { name: o.name, email: o.email });
  }

  return NextResponse.json({
    companies: rows.map((r) => ({ ...r, owner: ownerByCompany.get(r.id) ?? null })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
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

      // Enterprise disposition taxonomy — identical seeding to signup/register
      // (lib/dispositions/taxonomy.ts).
      await tx.insert(dispositionOptions).values(
        DEFAULT_DISPOSITIONS.map((d) => ({
          companyId: company.id,
          label: d.label,
          color: d.color,
          sortOrder: d.sortOrder,
          category: d.category,
        }))
      );
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

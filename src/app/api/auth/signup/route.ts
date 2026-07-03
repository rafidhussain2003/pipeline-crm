import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { companies, dispositionOptions, assignmentRules, automationSettings, users } from "@/db/schema";
import { hashPassword, setSessionCookie, setRefreshCookie } from "@/lib/auth";
import { issueRefreshToken } from "@/lib/refresh-tokens";
import { recordAudit } from "@/lib/audit";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
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
  const ip = getClientIp(req);
  const rl = checkRateLimit(`signup:${ip}`, 5, 60_000); // 5 signups/minute/IP
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many signup attempts. Please wait a minute and try again." }, { status: 429 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { companyName, plan, name, email, password } = parsed.data;

  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    return NextResponse.json({ error: "An account with that email already exists." }, { status: 409 });
  }

  const [company] = await db
    .insert(companies)
    .values({
      name: companyName,
      slug: slugify(companyName),
      status: "pending", // super-admin approves before it goes live (manual-billing phase)
      plan,
      pricePerAgentCents: PLAN_PRICE_CENTS[plan] ?? 1900,
    })
    .returning();

  const passwordHash = await hashPassword(password);
  const [admin] = await db
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

  // Seed sensible defaults so a new company isn't empty on first login.
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

  await setSessionCookie({
    userId: admin.id,
    companyId: company.id,
    role: "admin",
    email: admin.email,
  });
  const { rawToken, expiresAt } = await issueRefreshToken(admin.id, req.headers.get("user-agent") || undefined);
  await setRefreshCookie(rawToken, expiresAt);

  await recordAudit({
    companyId: company.id,
    userId: admin.id,
    action: "company.signed_up",
    entityType: "company",
    entityId: company.id,
    metadata: { plan },
  });

  return NextResponse.json({
    company,
    message:
      "Account created. Your company is pending activation — our team will review and activate it shortly.",
  });
}

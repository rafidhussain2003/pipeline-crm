import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { companies, users, dispositionOptions, assignmentRules, automationSettings } from "@/db/schema";
import { hashPassword, setSessionCookie, setRefreshCookie, verifyShortLived } from "@/lib/auth";
import { issueRefreshToken } from "@/lib/refresh-tokens";
import { recordAudit } from "@/lib/audit";
import { checkPolicy, getClientIp } from "@/lib/rate-limit";
import { PLANS } from "@/lib/plans";
import { eq } from "drizzle-orm";
import { withRoute } from "@/lib/api-handler";

const schema = z.object({ token: z.string().min(10), password: z.string().min(8) });

function slugify(name: string) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") + "-" + Math.random().toString(36).slice(2, 6);
}

// Step 3 of signup: exchange the verified-email token + a chosen password for a
// real company + admin account. Everything is created atomically; a 7-day trial
// starts immediately (no card required). The admin lands on onboarding.
export async function POST(req: NextRequest) {
  return withRoute("auth.register", "POST", req, async () => {
    const rl = checkPolicy("auth.signup", getClientIp(req));
    if (!rl.allowed) return NextResponse.json({ error: "Too many attempts. Please wait a minute." }, { status: 429 });

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose a password of at least 8 characters." }, { status: 400 });

    const claims = verifyShortLived<{ purpose: string; email: string; name: string; companyName: string }>(parsed.data.token);
    if (!claims || claims.purpose !== "signup" || !claims.email) {
      return NextResponse.json({ error: "Your verification expired. Please start again." }, { status: 400 });
    }
    const email = claims.email.toLowerCase();

    // Guard the race where a second registration for the same email slipped in.
    const [dup] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (dup) return NextResponse.json({ error: "An account with that email already exists." }, { status: 409 });

    const passwordHash = await hashPassword(parsed.data.password);
    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const { company, admin } = await db.transaction(async (tx) => {
      const [company] = await tx
        .insert(companies)
        .values({
          name: claims.companyName || "My Company",
          slug: slugify(claims.companyName || "company"),
          status: "active",
          plan: "basic",
          pricePerAgentCents: PLANS.basic.pricePerAgentCents,
          seats: 1,
          subscriptionStatus: "trial",
          trialStartedAt: now,
          trialEndsAt,
          onboardingCompleted: false,
        })
        .returning();
      const [admin] = await tx
        .insert(users)
        .values({ companyId: company.id, name: claims.name || "Admin", email, passwordHash, role: "admin", tier: "1", active: true, passwordChangedAt: now })
        .returning();
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
      await tx.insert(automationSettings).values({ companyId: company.id, autoAssignEnabled: true, assignmentMode: "weighted", autoRecycleEnabled: false, recycleAfterMinutes: 1440 });
      return { company, admin };
    });

    await setSessionCookie({ userId: admin.id, companyId: company.id, role: "admin", email: admin.email });
    const { rawToken, expiresAt } = await issueRefreshToken(admin.id, req.headers.get("user-agent") || undefined);
    await setRefreshCookie(rawToken, expiresAt);

    await recordAudit({ companyId: company.id, userId: admin.id, action: "company.signed_up", entityType: "company", entityId: company.id, metadata: { emailVerified: true } });
    return NextResponse.json({ ok: true, onboarding: true });
  });
}

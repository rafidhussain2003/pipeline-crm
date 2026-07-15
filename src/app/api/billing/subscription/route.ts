import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { daysRemaining, isBillingBlocked } from "@/lib/billing";
import { getStripe } from "@/lib/stripe";
import { PLANS, normalizePlan, getSeatUsage, monthlyTotalCents, trialWarning, formatCents } from "@/lib/plans";
import { recordAudit } from "@/lib/audit";
import { sendNotification } from "@/lib/notifications/service";

// Read-only — any signed-in company member can view billing status (same
// pattern as company-settings GET), but only "billing:manage" (admin) can
// act on it via /api/billing/checkout and /api/billing/portal.
export async function GET() {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [company] = await db.select().from(companies).where(eq(companies.id, session.companyId)).limit(1);
  if (!company) return NextResponse.json({ error: "Company not found." }, { status: 404 });

  let paymentMethod: { brand: string; last4: string } | null = null;
  if (company.stripeCustomerId && process.env.STRIPE_SECRET_KEY) {
    try {
      const stripe = getStripe();
      const customer = await stripe.customers.retrieve(company.stripeCustomerId, {
        expand: ["invoice_settings.default_payment_method"],
      });
      if (!customer.deleted) {
        const pm = customer.invoice_settings?.default_payment_method;
        if (pm && typeof pm !== "string" && pm.card) {
          paymentMethod = { brand: pm.card.brand, last4: pm.card.last4 };
        }
      }
    } catch (err) {
      // Display-only info — never fail the whole page over it.
      console.error("Failed to fetch Stripe payment method:", err);
    }
  }

  // Phase 13 seat-based billing snapshot.
  const plan = normalizePlan(company.plan);
  const usage = await getSeatUsage(company.id, company.seats);
  const monthly = monthlyTotalCents(plan, company.seats);

  return NextResponse.json({
    plan,
    planLabel: PLANS[plan].label,
    plans: Object.values(PLANS),
    seats: company.seats,
    activeAgents: usage.activeAgents,
    seatOverage: usage.overage,
    monthlyTotalCents: monthly,
    monthlyTotal: formatCents(monthly),
    subscriptionStatus: company.subscriptionStatus,
    daysRemaining: daysRemaining(company.trialEndsAt),
    trialWarning: trialWarning(company),
    trialEndsAt: company.trialEndsAt,
    currentPeriodEnd: company.currentPeriodEnd,
    blocked: isBillingBlocked(company),
    hasSubscription: !!company.stripeSubscriptionId,
    paymentMethod,
    canManageBilling: session.role === "admin",
  });
}

// Phase 13 — change plan and/or seat count (admin only). Updates the DB (the
// Stripe subscription quantity/price syncs via checkout/portal — Stripe-ready).
// Seats can't drop below the number of ACTIVE agents currently consuming them.
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session?.companyId || session.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const [company] = await db.select().from(companies).where(eq(companies.id, session.companyId)).limit(1);
  if (!company) return NextResponse.json({ error: "Company not found." }, { status: 404 });

  const requested: string = typeof body?.plan === "string" ? body.plan : "";
  const nextPlan = requested === "basic" || requested === "professional" || requested === "premium" ? requested : normalizePlan(company.plan);
  const usage = await getSeatUsage(company.id, company.seats);
  let nextSeats = Number.isFinite(body?.seats) ? Math.floor(body.seats) : company.seats;
  nextSeats = Math.max(1, Math.min(1000, nextSeats));
  if (nextSeats < usage.activeAgents) {
    return NextResponse.json({ error: `You have ${usage.activeAgents} active agents — suspend some before reducing to ${nextSeats} seats.` }, { status: 400 });
  }

  await db.update(companies).set({ plan: nextPlan, seats: nextSeats, pricePerAgentCents: PLANS[nextPlan].pricePerAgentCents, updatedAt: new Date() }).where(eq(companies.id, company.id));
  await recordAudit({ companyId: company.id, userId: session.userId, action: "billing.plan_updated", entityType: "company", entityId: company.id, before: { plan: normalizePlan(company.plan), seats: company.seats }, after: { plan: nextPlan, seats: nextSeats } });
  await sendNotification({ companyId: company.id, userId: session.userId, type: "subscription.updated", title: "Subscription updated", body: `Plan set to ${PLANS[nextPlan].label} with ${nextSeats} seat(s) — ${formatCents(monthlyTotalCents(nextPlan, nextSeats))}/mo.` }).catch(() => {});

  return NextResponse.json({ ok: true, plan: nextPlan, seats: nextSeats });
}

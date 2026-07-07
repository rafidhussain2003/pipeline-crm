import { NextResponse } from "next/server";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { daysRemaining, isBillingBlocked, planLabel } from "@/lib/billing";
import { getStripe } from "@/lib/stripe";

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

  return NextResponse.json({
    plan: company.plan,
    planLabel: planLabel(company.plan),
    subscriptionStatus: company.subscriptionStatus,
    daysRemaining: daysRemaining(company.trialEndsAt),
    trialEndsAt: company.trialEndsAt,
    currentPeriodEnd: company.currentPeriodEnd,
    blocked: isBillingBlocked(company),
    hasSubscription: !!company.stripeSubscriptionId,
    paymentMethod,
    canManageBilling: session.role === "admin",
  });
}

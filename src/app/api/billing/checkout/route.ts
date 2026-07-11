import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requirePermission } from "@/lib/permissions";
import { getOrCreateStripeCustomer } from "@/lib/billing";
import { getStripe, getStripePriceId } from "@/lib/stripe";
import { checkPolicy } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { getPublicAppUrl } from "@/lib/url";

// Creates a Stripe Checkout Session for the single monthly plan. This is
// only for starting a brand-new subscription — once a company has one,
// changes go through the Billing Portal (/api/billing/portal), matching
// "DO NOT build a custom payment system."
export async function POST(req: NextRequest) {
  const auth = await requirePermission("billing:manage");
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const rl = checkPolicy("api.admin", session.userId);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
  }

  const [company] = await db.select().from(companies).where(eq(companies.id, session.companyId)).limit(1);
  if (!company) return NextResponse.json({ error: "Company not found." }, { status: 404 });

  // Only block starting a new Checkout if there's a live subscription
  // already (active or past_due — fixable via the billing portal instead).
  // A "cancelled" subscription can and should be replaced by a fresh
  // Checkout — otherwise a company that cancelled would have no way back in.
  if (company.stripeSubscriptionId && (company.subscriptionStatus === "active" || company.subscriptionStatus === "past_due")) {
    return NextResponse.json(
      { error: "You already have a subscription. Use the billing portal to manage it." },
      { status: 400 }
    );
  }

  try {
    const stripe = getStripe();
    const customerId = await getOrCreateStripeCustomer(company);
    // Never req.nextUrl.origin — behind Render's reverse proxy that
    // reflects an internal service hostname, not the public domain. See
    // lib/url.ts.
    const origin = getPublicAppUrl();

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: company.id,
      line_items: [{ price: getStripePriceId(), quantity: 1 }],
      subscription_data: { metadata: { companyId: company.id } },
      success_url: `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/subscription?checkout=cancelled`,
    });

    await recordAudit({
      companyId: company.id,
      userId: session.userId,
      action: "billing.checkout_started",
      entityType: "company",
      entityId: company.id,
    });

    return NextResponse.json({ url: checkoutSession.url });
  } catch (err) {
    console.error("Failed to create checkout session:", err);
    return NextResponse.json({ error: "Could not start checkout. Please try again." }, { status: 500 });
  }
}

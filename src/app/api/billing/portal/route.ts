import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requirePermission } from "@/lib/permissions";
import { getOrCreateStripeCustomer } from "@/lib/billing";
import { getStripe } from "@/lib/stripe";
import { checkPolicy } from "@/lib/rate-limit";
import { getPublicAppUrl } from "@/lib/url";
import type Stripe from "stripe";

// One endpoint backs "Update Card", "Billing History", and "Cancel
// Subscription" on the Subscription page — all three are the same
// Stripe-hosted Billing Portal, just deep-linked to a different starting
// flow. See spec: "Use Stripe Billing Portal for: Update Card, Cancel
// Subscription, View Invoices, Download Receipts."
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

  const { flow } = await req.json().catch(() => ({ flow: undefined }));

  if (flow === "cancel" && !company.stripeSubscriptionId) {
    return NextResponse.json({ error: "There's no active subscription to cancel." }, { status: 400 });
  }

  try {
    const stripe = getStripe();
    const customerId = await getOrCreateStripeCustomer(company);
    // Never req.nextUrl.origin — behind Render's reverse proxy that
    // reflects an internal service hostname, not the public domain. See
    // lib/url.ts.
    const origin = getPublicAppUrl();

    let flow_data: Stripe.BillingPortal.SessionCreateParams.FlowData | undefined;
    if (flow === "update_payment_method") {
      flow_data = { type: "payment_method_update" };
    } else if (flow === "cancel" && company.stripeSubscriptionId) {
      flow_data = { type: "subscription_cancel", subscription_cancel: { subscription: company.stripeSubscriptionId } };
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/subscription`,
      ...(flow_data ? { flow_data } : {}),
    });

    return NextResponse.json({ url: portalSession.url });
  } catch (err) {
    console.error("Failed to create billing portal session:", err);
    return NextResponse.json({ error: "Could not open the billing portal. Please try again." }, { status: 500 });
  }
}

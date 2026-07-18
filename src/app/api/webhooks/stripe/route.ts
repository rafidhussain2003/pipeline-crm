import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getStripe } from "@/lib/stripe";
import { recordAudit } from "@/lib/audit";
import { invalidateBillingSnapshot } from "@/lib/billing";
import Stripe from "stripe";

export const runtime = "nodejs";

// Maps Stripe's subscription.status to our simpler 4-value enum (see
// subscriptionStatusEnum in schema.ts). We never put a subscription into
// Stripe's own "trialing" state (the free trial is tracked entirely in our
// own trial_started_at/trial_ends_at columns, before any Stripe
// subscription exists), but it's mapped defensively in case that ever
// changes.
function mapStripeStatus(status: Stripe.Subscription.Status): "active" | "past_due" | "cancelled" {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "incomplete":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
    case "unpaid":
    case "paused":
    default:
      return "cancelled";
  }
}

async function findCompanyId(customerId: string, metadataCompanyId?: string | null): Promise<string | null> {
  if (metadataCompanyId) return metadataCompanyId;
  const [company] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.stripeCustomerId, customerId))
    .limit(1);
  return company?.id || null;
}

function currentPeriodEndOf(subscription: Stripe.Subscription): Date | null {
  // API versions from late 2025 onward moved current_period_end from the
  // subscription itself down to its line items.
  const seconds = subscription.items.data[0]?.current_period_end;
  return seconds ? new Date(seconds * 1000) : null;
}

async function syncSubscription(companyId: string, subscription: Stripe.Subscription) {
  await db
    .update(companies)
    .set({
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: mapStripeStatus(subscription.status),
      currentPeriodEnd: currentPeriodEndOf(subscription),
      updatedAt: new Date(),
    })
    .where(eq(companies.id, companyId));

  // The proxy gate reads a 30s cached snapshot — drop it so this flip applies immediately.
  await invalidateBillingSnapshot(companyId);

  await recordAudit({
    companyId,
    userId: null,
    action: "billing.subscription_synced",
    entityType: "company",
    entityId: companyId,
    metadata: { stripeStatus: subscription.status, subscriptionId: subscription.id },
  });
}

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("Stripe webhook received but STRIPE_WEBHOOK_SECRET is not configured.");
    return NextResponse.json({ error: "Webhook not configured." }, { status: 500 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    // Signature verification is pure local HMAC — it doesn't need a live
    // API key, so it uses Stripe's static `webhooks` helper rather than
    // getStripe() (which requires STRIPE_SECRET_KEY). This keeps webhook
    // processing decoupled from whether the secret key happens to be
    // configured at any given moment.
    event = Stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription" || !session.subscription) break;
        const companyId = await findCompanyId(session.customer as string, session.client_reference_id);
        if (!companyId) {
          console.error("Stripe webhook: no company found for checkout session", session.id);
          break;
        }
        const stripe = getStripe();
        const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
        await syncSubscription(companyId, subscription);
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.created": {
        const subscription = event.data.object as Stripe.Subscription;
        const companyId = await findCompanyId(subscription.customer as string, subscription.metadata?.companyId);
        if (!companyId) {
          console.error("Stripe webhook: no company found for subscription", subscription.id);
          break;
        }
        await syncSubscription(companyId, subscription);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const companyId = await findCompanyId(subscription.customer as string, subscription.metadata?.companyId);
        if (!companyId) break;
        await db
          .update(companies)
          .set({ subscriptionStatus: "cancelled", updatedAt: new Date() })
          .where(eq(companies.id, companyId));
        await invalidateBillingSnapshot(companyId);
        await recordAudit({
          companyId,
          userId: null,
          action: "billing.subscription_cancelled",
          entityType: "company",
          entityId: companyId,
        });
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string | null;
        if (!customerId) break;
        const companyId = await findCompanyId(customerId);
        if (!companyId) break;
        await db
          .update(companies)
          .set({ subscriptionStatus: "past_due", updatedAt: new Date() })
          .where(eq(companies.id, companyId));
        await invalidateBillingSnapshot(companyId);
        await recordAudit({
          companyId,
          userId: null,
          action: "billing.payment_failed",
          entityType: "company",
          entityId: companyId,
        });
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string | null;
        // Newer Stripe API versions nest the subscription reference under
        // parent.subscription_details rather than a top-level field.
        const subRef = invoice.parent?.subscription_details?.subscription;
        const subscriptionId = typeof subRef === "string" ? subRef : subRef?.id || null;
        if (!customerId) break;
        const companyId = await findCompanyId(customerId);
        if (!companyId) break;
        if (subscriptionId) {
          const stripe = getStripe();
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          await syncSubscription(companyId, subscription);
        } else {
          await db
            .update(companies)
            .set({ subscriptionStatus: "active", updatedAt: new Date() })
            .where(eq(companies.id, companyId));
          await invalidateBillingSnapshot(companyId);
        }
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error(`Stripe webhook handler failed for event ${event.type}:`, err);
    // Still 200 — Stripe retries on non-2xx, and retrying a bug in our own
    // handler won't fix it. Errors are logged above for manual follow-up.
  }

  return NextResponse.json({ received: true });
}

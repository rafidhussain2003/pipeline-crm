import { db } from "@/db";
import { companies } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getStripe } from "./stripe";
import { cache } from "./infra/cache";

// Cached subscription fields for the proxy's per-request billing gate.
//
// Why: the proxy ran this SELECT fresh on EVERY company-scoped API request.
// Against the production database a round trip is ~300-400ms, so the gate
// alone added that to every single API call in the app (Phase 5 baseline:
// simple one-query endpoints measured ~780ms — half of it was this check).
//
// Staleness is bounded and safe: the row is cached, but isBillingBlocked()
// still recomputes against the current clock on every request, so a trial or
// comp grant expiring mid-window blocks ON TIME — the dates in the row don't
// change, only "now" does. The only delayed transitions are Stripe-driven
// status flips (cancel / reactivate), bounded by the TTL below, and the
// write paths invalidate the key so same-instance flips apply immediately.
// Same policy and TTL horizon as featureService's 60s entitlement cache,
// which lives right next to this check in the proxy.
const BILLING_SNAPSHOT_TTL_MS = 30_000;
type BillingSnapshot = Pick<
  BillingCompany,
  "subscriptionStatus" | "trialEndsAt" | "currentPeriodEnd" | "stripeSubscriptionId"
> | null;

export async function getBillingSnapshot(companyId: string): Promise<BillingSnapshot> {
  return cache.getOrSet(`billing-snapshot:${companyId}`, BILLING_SNAPSHOT_TTL_MS, async () => {
    const [company] = await db
      .select({
        subscriptionStatus: companies.subscriptionStatus,
        trialEndsAt: companies.trialEndsAt,
        currentPeriodEnd: companies.currentPeriodEnd,
        stripeSubscriptionId: companies.stripeSubscriptionId,
      })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);
    return company ?? null;
  });
}

// Call after any write to a company's subscription fields (Stripe webhook,
// checkout confirm, super-admin activation) so the gate reflects it at once.
export async function invalidateBillingSnapshot(companyId: string): Promise<void> {
  await cache.delete(`billing-snapshot:${companyId}`);
}

type BillingCompany = {
  id: string;
  name: string;
  supportEmail: string | null;
  subscriptionStatus: "trial" | "active" | "past_due" | "cancelled";
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
};

export function daysRemaining(trialEndsAt: Date | null): number {
  if (!trialEndsAt) return 0;
  const ms = trialEndsAt.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

export function isTrialExpired(company: Pick<BillingCompany, "subscriptionStatus" | "trialEndsAt">): boolean {
  if (company.subscriptionStatus !== "trial") return false;
  if (!company.trialEndsAt) return false;
  return company.trialEndsAt.getTime() < Date.now();
}

// A super-admin can grant a company free/complimentary access (any plan,
// including "free", for however many years) by setting subscriptionStatus
// to "active" with no real Stripe subscription behind it and an optional
// currentPeriodEnd far in the future — see the super-admin company routes.
// Leaving currentPeriodEnd null means the grant never expires on its own.
// Scoped to `!stripeSubscriptionId` specifically so a REAL paying
// customer's currentPeriodEnd (only ever a snapshot from the last Stripe
// webhook, and can legitimately lag a few minutes behind Stripe's own
// renewal) can never cause a false block — only a comp with no real
// subscription behind it can expire this way.
export function isCompExpired(
  company: Pick<BillingCompany, "subscriptionStatus" | "currentPeriodEnd" | "stripeSubscriptionId">
): boolean {
  if (company.subscriptionStatus !== "active") return false;
  if (company.stripeSubscriptionId) return false;
  if (!company.currentPeriodEnd) return false;
  return company.currentPeriodEnd.getTime() < Date.now();
}

// What actually stops CRM usage. "past_due" is deliberately NOT blocking —
// it's a grace period while Stripe retries the card (see subscriptionStatusEnum's
// comment in schema.ts) — only an expired trial, an expired comp grant, or
// a fully cancelled subscription locks the app.
export function isBillingBlocked(
  company: Pick<BillingCompany, "subscriptionStatus" | "trialEndsAt" | "currentPeriodEnd" | "stripeSubscriptionId">
): boolean {
  if (company.subscriptionStatus === "cancelled") return true;
  if (isTrialExpired(company)) return true;
  return isCompExpired(company);
}

// Shared between the (app) layout's full-page block screen and proxy.ts's
// API-level 402s, so both surfaces agree on why a company is blocked.
export function billingBlockReason(
  company: Pick<BillingCompany, "subscriptionStatus" | "trialEndsAt" | "currentPeriodEnd" | "stripeSubscriptionId">
): "trial_expired" | "comp_expired" | "cancelled" | null {
  if (company.subscriptionStatus === "cancelled") return "cancelled";
  if (isTrialExpired(company)) return "trial_expired";
  if (isCompExpired(company)) return "comp_expired";
  return null;
}

export function planLabel(plan: string): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

// Used by the super-admin company routes to turn "grant N years free" into
// a concrete currentPeriodEnd. setFullYear (not day-math) so leap years
// land on the correct calendar date.
export function yearsFromNow(years: number): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() + years);
  return d;
}

// Every company gets a Stripe Customer lazily, the first time any billing
// action needs one (Checkout, Billing Portal) — not eagerly at signup, so
// companies that never touch billing don't leave empty Customer objects in
// Stripe. Idempotent: reuses stripeCustomerId if already set.
export async function getOrCreateStripeCustomer(company: BillingCompany): Promise<string> {
  if (company.stripeCustomerId) return company.stripeCustomerId;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    name: company.name,
    email: company.supportEmail || undefined,
    metadata: { companyId: company.id },
  });

  await db.update(companies).set({ stripeCustomerId: customer.id }).where(eq(companies.id, company.id));

  return customer.id;
}

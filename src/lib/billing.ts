import { db } from "@/db";
import { companies } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getStripe } from "./stripe";

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

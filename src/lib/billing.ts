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
  stripeCustomerId: string | null;
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

// What actually stops CRM usage. "past_due" is deliberately NOT blocking —
// it's a grace period while Stripe retries the card (see subscriptionStatusEnum's
// comment in schema.ts) — only an expired trial or a fully cancelled
// subscription locks the app.
export function isBillingBlocked(company: Pick<BillingCompany, "subscriptionStatus" | "trialEndsAt">): boolean {
  if (company.subscriptionStatus === "cancelled") return true;
  return isTrialExpired(company);
}

// Shared between the (app) layout's full-page block screen and proxy.ts's
// API-level 402s, so both surfaces agree on why a company is blocked.
export function billingBlockReason(
  company: Pick<BillingCompany, "subscriptionStatus" | "trialEndsAt">
): "trial_expired" | "cancelled" | null {
  if (company.subscriptionStatus === "cancelled") return "cancelled";
  if (isTrialExpired(company)) return "trial_expired";
  return null;
}

export function planLabel(plan: string): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
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

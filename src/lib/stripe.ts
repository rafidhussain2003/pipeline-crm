import Stripe from "stripe";

// Lazily instantiated so importing this module never crashes the app in an
// environment where Stripe isn't configured yet (e.g. local dev before the
// developer has set up a Stripe account) — only the billing routes that
// actually call getStripe() will fail, with a clear error, when it's missing.
let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error(
        "STRIPE_SECRET_KEY is not set. Add it to your environment to enable billing (see .env.example)."
      );
    }
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}

// Single monthly plan for now (see spec: "Only one monthly subscription
// plan is needed for now") — one Stripe Price ID, not a plan table.
export function getStripePriceId(): string {
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    throw new Error("STRIPE_PRICE_ID is not set. Add it to your environment to enable billing (see .env.example).");
  }
  return priceId;
}

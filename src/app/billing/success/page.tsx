import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getStripe } from "@/lib/stripe";

// Lives outside the (app) route group on purpose: it must be reachable even
// while the trial-expired block screen would otherwise cover every (app)
// route, and it eagerly syncs the subscription from Stripe rather than
// waiting on the webhook (which can lag a second or two behind the
// redirect) — so the user isn't shown "please subscribe" right after
// they've just paid, then never asking Stripe about it again once it's
// been confirmed here.
export default async function BillingSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.companyId) redirect("/super-admin");

  const { session_id } = await searchParams;
  if (!session_id) redirect("/subscription");

  const [company] = await db.select().from(companies).where(eq(companies.id, session.companyId)).limit(1);
  if (!company) redirect("/subscription");

  try {
    const stripe = getStripe();
    const checkoutSession = await stripe.checkout.sessions.retrieve(session_id, { expand: ["subscription"] });

    // Only trust this Checkout Session if it actually belongs to the
    // signed-in company — a session_id is not a secret (it's in the URL),
    // so this stops one company from confirming another's checkout.
    const belongsToCompany =
      checkoutSession.client_reference_id === company.id ||
      (typeof checkoutSession.customer === "string" && checkoutSession.customer === company.stripeCustomerId);

    if (belongsToCompany && checkoutSession.subscription && typeof checkoutSession.subscription !== "string") {
      const subscription = checkoutSession.subscription;
      const seconds = subscription.items.data[0]?.current_period_end;
      await db
        .update(companies)
        .set({
          stripeCustomerId: (checkoutSession.customer as string) || company.stripeCustomerId,
          stripeSubscriptionId: subscription.id,
          subscriptionStatus: subscription.status === "active" ? "active" : company.subscriptionStatus,
          currentPeriodEnd: seconds ? new Date(seconds * 1000) : company.currentPeriodEnd,
          updatedAt: new Date(),
        })
        .where(eq(companies.id, company.id));
    }
  } catch (err) {
    // Non-fatal — the webhook will still sync this shortly. Just don't
    // block the redirect over a display-only optimization failing.
    console.error("Failed to eagerly confirm checkout session:", err);
  }

  redirect("/subscription?checkout=success");
}

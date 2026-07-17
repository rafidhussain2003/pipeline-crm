import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/db";
import { companies, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import Sidebar from "@/components/Sidebar";
import BillingBanner from "@/components/billing/BillingBanner";
import BillingBlockScreen from "@/components/billing/BillingBlockScreen";
import ForcePasswordChange from "@/components/auth/ForcePasswordChange";
import CallbackReminders from "@/components/callbacks/CallbackReminders";
import { billingBlockReason, daysRemaining, isBillingBlocked } from "@/lib/billing";
import { getEnabledFeatures, type FeatureMap } from "@/lib/features";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  // Phase 13: an invited user with a temporary password must create their own
  // before doing anything else — a hard gate that blocks the whole app.
  const [me] = await db.select({ mustChange: users.mustChangePassword }).from(users).where(eq(users.id, session.userId)).limit(1);
  if (me?.mustChange) return <ForcePasswordChange />;

  let companyName = "Super Admin";
  let billing: { subscriptionStatus: "trial" | "active" | "past_due" | "cancelled"; daysRemaining: number } | null =
    null;
  // Phase 18: the company's entitled modules, resolved ONCE per render through
  // the cached featureService — the sidebar and every layout-level surface key
  // off this. Null for super_admin (no company; they manage features instead).
  let features: FeatureMap | null = null;

  if (session.companyId) {
    features = await getEnabledFeatures(session.companyId);
    const [company] = await db.select().from(companies).where(eq(companies.id, session.companyId)).limit(1);
    companyName = company?.name || "";

    // Trial/subscription gate — see lib/billing.ts for what counts as
    // blocking (an expired trial or a cancelled subscription) vs. what's
    // just a warning (past_due, a grace period while Stripe retries).
    // super_admin has no companyId and is never subject to this.
    if (company && isBillingBlocked(company)) {
      return <BillingBlockScreen reason={billingBlockReason(company) ?? "cancelled"} />;
    }
    if (company) {
      billing = { subscriptionStatus: company.subscriptionStatus, daysRemaining: daysRemaining(company.trialEndsAt) };
    }
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Presence heartbeat is rendered inside Sidebar (role-gated there) —
          only company members take leads and need presence tracked;
          super_admin has no companyId and doesn't participate in routing. */}
      <Sidebar companyName={companyName} role={session.role} features={features} />
      <div className="flex-1 min-w-0 flex flex-col">
        {billing && (
          <BillingBanner
            subscriptionStatus={billing.subscriptionStatus}
            daysRemaining={billing.daysRemaining}
            canManageBilling={session.role === "admin"}
          />
        )}
        <main className="flex-1 min-w-0">{children}</main>
      </div>
      {/* Callback reminders (Phase 15) — one SSE connection per session, mounted
          once here so a reminder reaches the agent on whatever page they're on.
          super_admin has no companyId and schedules no callbacks. Phase 18: not
          mounted at all when the Callback Engine module is disabled, so the
          stream is never even opened. */}
      {session.companyId && features?.callback_engine && <CallbackReminders />}
    </div>
  );
}

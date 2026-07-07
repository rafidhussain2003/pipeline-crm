import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { eq } from "drizzle-orm";
import Sidebar from "@/components/Sidebar";
import BillingBanner from "@/components/billing/BillingBanner";
import BillingBlockScreen from "@/components/billing/BillingBlockScreen";
import { billingBlockReason, daysRemaining, isBillingBlocked } from "@/lib/billing";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  let companyName = "Super Admin";
  let billing: { subscriptionStatus: "trial" | "active" | "past_due" | "cancelled"; daysRemaining: number } | null =
    null;

  if (session.companyId) {
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
      <Sidebar companyName={companyName} role={session.role} />
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
    </div>
  );
}

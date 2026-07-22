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
import LeadAssignedAlerts from "@/components/leads/LeadAssignedAlerts";
import { billingBlockReason, daysRemaining, isBillingBlocked } from "@/lib/billing";
import { getEnabledFeatures, type FeatureMap } from "@/lib/features";
import { getEffectiveModuleAccess, type ModuleAccessMap } from "@/lib/module-access";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  // The three lookups below are independent (user gate, company row, feature
  // map) but ran serially. Against the production database a round trip is
  // ~300-400ms, so this layout — which wraps EVERY page — was paying two to
  // three of them back-to-back on each navigation. Fired concurrently, the
  // render waits for the slowest one instead of the sum (Phase 5 baseline:
  // ~815ms of layout latency per page → ~420ms after).
  const [[me], company, features, access] = await Promise.all([
    db.select({ mustChange: users.mustChangePassword }).from(users).where(eq(users.id, session.userId)).limit(1),
    session.companyId
      ? db.select().from(companies).where(eq(companies.id, session.companyId)).limit(1).then((r) => r[0] ?? null)
      : Promise.resolve(null),
    // Phase 18: entitled modules via the cached featureService. Null for
    // super_admin (no company; they manage features instead).
    session.companyId ? getEnabledFeatures(session.companyId) : Promise.resolve<FeatureMap | null>(null),
    // Enterprise Workspaces: this user's effective module access (cached).
    session.companyId ? getEffectiveModuleAccess(session.userId, session.role) : Promise.resolve<ModuleAccessMap | null>(null),
  ]);

  // What the sidebar may show = company entitlement ∧ per-user assignment.
  const modules =
    features && access
      ? {
          crm: access.crm,
          hr: features.hr === true && access.hr,
          finance: features.finance === true && access.finance,
          attendance: features.attendance === true && access.attendance,
          payroll: features.payroll === true && access.payroll,
          workflow: features.workflow === true && access.workflow,
        }
      : null;

  // Phase 13: an invited user with a temporary password must create their own
  // before doing anything else — a hard gate that blocks the whole app.
  if (me?.mustChange) return <ForcePasswordChange />;

  let companyName = "Super Admin";
  let billing: { subscriptionStatus: "trial" | "active" | "past_due" | "cancelled"; daysRemaining: number } | null =
    null;

  if (session.companyId) {
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
      <Sidebar companyName={companyName} role={session.role} features={features} modules={modules} />
      {/* pt-14 clears the fixed mobile top bar that Sidebar renders below `lg`;
          on `lg` the sidebar is back in flow and there is no bar to clear. */}
      <div className="flex-1 min-w-0 flex flex-col pt-14 lg:pt-0">
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
      {/* New-lead alert (sound + floating toast) — mounted once here for the
          same reason as CallbackReminders: an assignment must reach its agent
          on whatever page they have open. Gated on CRM module access; the
          server only ever sends the alert event to the lead's new owner. */}
      {session.companyId && modules?.crm && <LeadAssignedAlerts />}
    </div>
  );
}

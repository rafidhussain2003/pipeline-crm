"use client";

import { useRouter } from "next/navigation";
import UpgradeButton from "./UpgradeButton";

// Replaces the entire (app) shell (no sidebar, no page content) when
// subscriptionStatus is a blocking state — see isBillingBlocked() in
// lib/billing.ts. Deliberately minimal: just the message, a way to pay,
// and a way to sign out. Nothing else in the CRM is reachable from here.
export default function BillingBlockScreen({ reason }: { reason: "trial_expired" | "comp_expired" | "cancelled" }) {
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const REASON_MESSAGE: Record<typeof reason, string> = {
    trial_expired: "Your free trial has expired.",
    comp_expired: "Your complimentary access has expired.",
    cancelled: "Your subscription has been cancelled.",
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="max-w-sm w-full text-center">
        <h1 className="text-lg font-semibold text-slate-900 mb-2">{REASON_MESSAGE[reason]}</h1>
        <p className="text-sm text-slate-500 mb-6">Please subscribe to continue using Pipeline CRM.</p>
        <div className="flex flex-col items-center gap-3">
          <UpgradeButton className="w-full bg-slate-900 text-white text-sm font-medium px-4 py-2.5 rounded-md hover:bg-slate-800" />
          <button onClick={logout} className="text-sm font-medium text-slate-400 hover:text-slate-600">
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

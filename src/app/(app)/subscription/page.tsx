"use client";

import { useEffect, useState } from "react";
import UpgradeButton from "@/components/billing/UpgradeButton";
import PortalButton from "@/components/billing/PortalButton";

type SubscriptionInfo = {
  plan: string;
  planLabel: string;
  subscriptionStatus: "trial" | "active" | "past_due" | "cancelled";
  daysRemaining: number;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  blocked: boolean;
  hasSubscription: boolean;
  paymentMethod: { brand: string; last4: string } | null;
  canManageBilling: boolean;
};

const STATUS_STYLES: Record<string, string> = {
  trial: "bg-blue-50 text-blue-700",
  active: "bg-emerald-50 text-emerald-700",
  past_due: "bg-amber-50 text-amber-700",
  cancelled: "bg-slate-100 text-slate-600",
};

const STATUS_LABELS: Record<string, string> = {
  trial: "Trial",
  active: "Active",
  past_due: "Past Due",
  cancelled: "Cancelled",
};

export default function SubscriptionPage() {
  const [info, setInfo] = useState<SubscriptionInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/billing/subscription")
      .then((r) => r.json())
      .then((d) => {
        setInfo(d);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="p-6 max-w-2xl">
        <p className="text-sm text-slate-400">Loading…</p>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="p-6 max-w-2xl">
        <p className="text-sm text-red-600">Could not load subscription details.</p>
      </div>
    );
  }

  const canResubscribe = !info.hasSubscription || info.subscriptionStatus === "cancelled";
  const canCancel = info.hasSubscription && (info.subscriptionStatus === "active" || info.subscriptionStatus === "past_due");

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-xl font-semibold text-slate-900 mb-1">Subscription</h1>
      <p className="text-sm text-slate-500 mb-6">Manage your plan and payment details.</p>

      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        <div className="p-5 grid grid-cols-2 gap-y-4">
          <div className="text-sm text-slate-500">Current Plan</div>
          <div className="text-sm font-medium text-slate-900 text-right">{info.planLabel}</div>

          <div className="text-sm text-slate-500">Status</div>
          <div className="text-right">
            <span className={`text-xs font-medium rounded-full px-2.5 py-1 ${STATUS_STYLES[info.subscriptionStatus]}`}>
              {STATUS_LABELS[info.subscriptionStatus]}
            </span>
          </div>

          {info.subscriptionStatus === "trial" && (
            <>
              <div className="text-sm text-slate-500">Days Remaining</div>
              <div className="text-sm font-medium text-slate-900 text-right">{info.daysRemaining}</div>
            </>
          )}

          {info.subscriptionStatus === "active" && info.currentPeriodEnd && (
            <>
              <div className="text-sm text-slate-500">Next Billing Date</div>
              <div className="text-sm font-medium text-slate-900 text-right">
                {new Date(info.currentPeriodEnd).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </div>
            </>
          )}

          <div className="text-sm text-slate-500">Payment Method</div>
          <div className="text-sm font-medium text-slate-900 text-right capitalize">
            {info.paymentMethod ? `${info.paymentMethod.brand} •••• ${info.paymentMethod.last4}` : "None on file"}
          </div>
        </div>

        {info.canManageBilling && (
          <div className="p-5 flex flex-wrap gap-2">
            {canResubscribe && <UpgradeButton label="Upgrade Plan" />}
            <PortalButton flow="update_payment_method" label="Update Card" />
            <PortalButton label="Billing History" />
            {canCancel && (
              <PortalButton
                flow="cancel"
                label="Cancel Subscription"
                confirmMessage="Cancel your subscription? You'll keep access until the end of the current billing period."
                className="text-sm font-medium text-red-600 bg-white border border-red-200 px-4 py-2 rounded-md hover:bg-red-50"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

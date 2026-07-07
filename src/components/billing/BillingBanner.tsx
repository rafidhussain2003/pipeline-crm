import UpgradeButton from "./UpgradeButton";
import PortalButton from "./PortalButton";

// Rendered by (app)/layout.tsx above the page content — never on its own
// route, so it's a plain server component (no client state of its own; the
// buttons inside handle their own loading state).
export default function BillingBanner({
  subscriptionStatus,
  daysRemaining,
  canManageBilling,
}: {
  subscriptionStatus: "trial" | "active" | "past_due" | "cancelled";
  daysRemaining: number;
  // Only admin holds "billing:manage" — showing the action button to
  // other roles would just earn them a 403, so it's hidden for them
  // instead (the informational text still shows to everyone).
  canManageBilling: boolean;
}) {
  if (subscriptionStatus === "trial") {
    return (
      <div className="bg-blue-50 border-b border-blue-100 px-6 py-2.5 flex items-center justify-between gap-4">
        <p className="text-sm text-blue-900">
          <span className="font-semibold">Free Trial</span> — {daysRemaining} {daysRemaining === 1 ? "Day" : "Days"}{" "}
          Remaining
        </p>
        {canManageBilling && (
          <UpgradeButton className="text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-md" />
        )}
      </div>
    );
  }

  if (subscriptionStatus === "past_due") {
    return (
      <div className="bg-amber-50 border-b border-amber-100 px-6 py-2.5 flex items-center justify-between gap-4">
        <p className="text-sm text-amber-900">
          <span className="font-semibold">Payment failed</span> — please update your payment method to keep your
          subscription active.
        </p>
        {canManageBilling && (
          <PortalButton
            flow="update_payment_method"
            label="Update Payment Method"
            className="text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 px-3 py-1.5 rounded-md"
          />
        )}
      </div>
    );
  }

  return null;
}

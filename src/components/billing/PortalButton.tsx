"use client";

import { useState } from "react";

// Opens the Stripe-hosted Billing Portal, optionally deep-linked to a
// specific flow. Backs "Update Card", "Billing History", and "Cancel
// Subscription" everywhere in the app — see /api/billing/portal.
export default function PortalButton({
  flow,
  label,
  className,
  confirmMessage,
}: {
  flow?: "update_payment_method" | "cancel";
  label: string;
  className?: string;
  confirmMessage?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function openPortal() {
    if (confirmMessage && !confirm(confirmMessage)) return;
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flow }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        setLoading(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button
        onClick={openPortal}
        disabled={loading}
        className={
          className ||
          "text-sm font-medium text-slate-700 bg-white border border-slate-200 px-4 py-2 rounded-md hover:bg-slate-50 disabled:opacity-40"
        }
      >
        {loading ? "Opening…" : label}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

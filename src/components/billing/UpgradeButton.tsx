"use client";

import { useState } from "react";

// Shared by the trial banner, the trial-expired block screen, and the
// Subscription page's "Upgrade Plan" button — all three just need to start
// a Stripe Checkout session and redirect there (see spec: "DO NOT build a
// custom payment system").
export default function UpgradeButton({ label = "Upgrade Now", className }: { label?: string; className?: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function startCheckout() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/billing/checkout", { method: "POST" });
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
        onClick={startCheckout}
        disabled={loading}
        className={className || "bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-40"}
      >
        {loading ? "Redirecting…" : label}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

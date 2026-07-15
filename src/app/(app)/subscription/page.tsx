"use client";

// Phase 13 — seat-based Billing page: current plan, seats, usage (active
// agents), trial countdown, renewal, invoices, and plan/seat selection.
// Stripe checkout/portal handle the actual payment (Stripe-ready).
import { useEffect, useState } from "react";
import UpgradeButton from "@/components/billing/UpgradeButton";
import PortalButton from "@/components/billing/PortalButton";

type Plan = { id: string; label: string; pricePerAgentCents: number; features: string[] };
type Info = {
  plan: string; planLabel: string; plans: Plan[]; seats: number; activeAgents: number; seatOverage: number;
  monthlyTotal: string; monthlyTotalCents: number;
  subscriptionStatus: "trial" | "active" | "past_due" | "cancelled";
  daysRemaining: number; trialWarning: { level: string; daysRemaining: number };
  currentPeriodEnd: string | null; blocked: boolean; hasSubscription: boolean;
  paymentMethod: { brand: string; last4: string } | null; canManageBilling: boolean;
};

const STATUS: Record<string, string> = { trial: "bg-blue-50 text-blue-700", active: "bg-emerald-50 text-emerald-700", past_due: "bg-amber-50 text-amber-700", cancelled: "bg-slate-100 text-slate-600" };
const money = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;

export default function BillingPage() {
  const [info, setInfo] = useState<Info | null>(null);
  const [plan, setPlan] = useState("");
  const [seats, setSeats] = useState(1);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const d = await fetch("/api/billing/subscription").then((r) => r.json());
    setInfo(d); setPlan(d.plan); setSeats(d.seats);
  }
  useEffect(() => { load(); }, []);

  async function save() {
    setBusy(true); setMsg("");
    const res = await fetch("/api/billing/subscription", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan, seats }) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg(d.error || "Could not update.");
    setMsg("Plan updated."); load();
  }

  if (!info) return <div className="p-6 max-w-3xl text-sm text-slate-400">Loading…</div>;

  const selectedPlan = info.plans.find((p) => p.id === plan);
  const projected = selectedPlan ? selectedPlan.pricePerAgentCents * seats : 0;
  const canCancel = info.hasSubscription && (info.subscriptionStatus === "active" || info.subscriptionStatus === "past_due");

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div><h1 className="text-xl font-semibold text-slate-900">Billing</h1><p className="text-sm text-slate-500 mt-1">Seat-based pricing — only active agents consume a seat.</p></div>

      {/* Trial / status banner */}
      {info.subscriptionStatus === "trial" && (
        <div className={`rounded-lg px-4 py-3 text-sm ${info.trialWarning.level === "expired" ? "bg-red-50 text-red-700" : info.trialWarning.level === "1day" || info.trialWarning.level === "3days" ? "bg-amber-50 text-amber-800" : "bg-blue-50 text-blue-800"}`}>
          {info.trialWarning.level === "expired" ? "Your free trial has ended — subscribe to keep using Ziplod." : `Free trial — ${info.daysRemaining} day${info.daysRemaining === 1 ? "" : "s"} remaining.`}
        </div>
      )}

      {/* Current summary */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[["Plan", info.planLabel], ["Seats", String(info.seats)], ["Active agents", String(info.activeAgents)], ["Monthly", info.monthlyTotal]].map(([k, v]) => (
          <div key={k}><div className="text-[10px] uppercase tracking-wide text-slate-400">{k}</div><div className="text-sm font-medium text-slate-900">{v}</div></div>
        ))}
        <div><div className="text-[10px] uppercase tracking-wide text-slate-400">Status</div><span className={`text-xs font-medium rounded-full px-2 py-0.5 ${STATUS[info.subscriptionStatus]}`}>{info.subscriptionStatus}</span></div>
        <div><div className="text-[10px] uppercase tracking-wide text-slate-400">Renews</div><div className="text-sm font-medium text-slate-900">{info.currentPeriodEnd ? new Date(info.currentPeriodEnd).toLocaleDateString() : "—"}</div></div>
        <div><div className="text-[10px] uppercase tracking-wide text-slate-400">Payment</div><div className="text-sm font-medium text-slate-900 capitalize">{info.paymentMethod ? `${info.paymentMethod.brand} ••${info.paymentMethod.last4}` : "None"}</div></div>
        {info.seatOverage > 0 && <div className="col-span-2 text-xs text-amber-700">You have {info.seatOverage} more active agent(s) than seats — add seats below.</div>}
      </div>

      {/* Plan selection */}
      {info.canManageBilling && (
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Choose a plan</h2>
          <div className="grid sm:grid-cols-3 gap-3">
            {info.plans.map((p) => (
              <button key={p.id} onClick={() => setPlan(p.id)} className={`text-left border rounded-lg p-4 ${plan === p.id ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-200"}`}>
                <div className="flex items-center justify-between"><span className="text-sm font-semibold text-slate-900">{p.label}</span>{plan === p.id && <span className="text-xs text-slate-900">✓</span>}</div>
                <div className="text-lg font-bold text-slate-900 mt-1">{money(p.pricePerAgentCents)}<span className="text-xs font-normal text-slate-400">/agent/mo</span></div>
                <ul className="mt-2 space-y-1">{p.features.map((f) => <li key={f} className="text-[11px] text-slate-500">• {f}</li>)}</ul>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 mt-4">
            <label className="text-sm text-slate-600">Seats
              <input type="number" min={Math.max(1, info.activeAgents)} value={seats} onChange={(e) => setSeats(Math.max(1, parseInt(e.target.value || "1", 10)))} className="ml-2 w-20 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
            <div className="text-sm text-slate-500">= <strong className="text-slate-900">{money(projected)}</strong>/month</div>
            <button onClick={save} disabled={busy} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">{busy ? "Saving…" : "Update plan"}</button>
            {msg && <span className="text-xs text-slate-500">{msg}</span>}
          </div>

          <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-slate-100">
            {(!info.hasSubscription || info.subscriptionStatus === "cancelled") && <UpgradeButton label="Subscribe with card" />}
            <PortalButton flow="update_payment_method" label="Update card" />
            <PortalButton label="Invoices & billing history" />
            {canCancel && <PortalButton flow="cancel" label="Cancel subscription" confirmMessage="Cancel your subscription? You keep access until the period ends." className="text-sm font-medium text-red-600 bg-white border border-red-200 px-4 py-2 rounded-md hover:bg-red-50" />}
          </div>
        </div>
      )}
    </div>
  );
}

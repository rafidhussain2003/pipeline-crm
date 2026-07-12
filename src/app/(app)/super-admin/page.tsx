"use client";

import { useEffect, useState } from "react";

type Company = {
  id: string;
  name: string;
  status: string;
  plan: string;
  subscriptionStatus: "trial" | "active" | "past_due" | "cancelled";
  currentPeriodEnd: string | null;
  stripeSubscriptionId: string | null;
  customDomain: string | null;
  customDomainVerified: boolean;
  createdAt: string;
};

const PLAN_OPTIONS = ["free", "starter", "growth", "scale"];

export default function SuperAdminPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [form, setForm] = useState({
    companyName: "",
    adminName: "",
    adminEmail: "",
    adminPassword: "",
    plan: "starter",
    freeYears: "",
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [grantYears, setGrantYears] = useState<Record<string, string>>({});
  const [granting, setGranting] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/super-admin/companies");
    const data = await res.json();
    setCompanies(data.companies || []);
  }

  useEffect(() => {
    load();
  }, []);

  async function setStatus(id: string, status: string) {
    setCompanies((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)));
    await fetch(`/api/super-admin/companies/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  }

  async function setPlan(id: string, plan: string) {
    setCompanies((prev) => prev.map((c) => (c.id === id ? { ...c, plan } : c)));
    await fetch(`/api/super-admin/companies/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan }),
    });
  }

  // Activates the company (any plan, including free) for however many
  // years with no Stripe subscription behind it — 0 or blank means "no
  // expiry, free forever" (see isCompExpired() in lib/billing.ts).
  async function grantFreeAccess(id: string) {
    const raw = grantYears[id];
    const years = raw ? Number(raw) : 0;
    if (raw && (Number.isNaN(years) || years < 0)) return;
    setGranting(id);
    const res = await fetch(`/api/super-admin/companies/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ freeYears: years }),
    });
    setGranting(null);
    if (res.ok) {
      setGrantYears((prev) => ({ ...prev, [id]: "" }));
      load();
    }
  }

  async function addCompany() {
    setError("");
    setSubmitting(true);
    const res = await fetch("/api/super-admin/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, freeYears: form.freeYears ? Number(form.freeYears) : undefined }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(data.error || "Something went wrong");
      return;
    }
    setForm({ companyName: "", adminName: "", adminEmail: "", adminPassword: "", plan: "starter", freeYears: "" });
    load();
  }

  const statusColor: Record<string, string> = {
    pending: "bg-amber-50 text-amber-700",
    active: "bg-emerald-50 text-emerald-700",
    suspended: "bg-red-50 text-red-700",
  };

  const subStatusColor: Record<string, string> = {
    trial: "bg-blue-50 text-blue-700",
    active: "bg-emerald-50 text-emerald-700",
    past_due: "bg-amber-50 text-amber-700",
    cancelled: "bg-slate-100 text-slate-600",
  };

  function subStatusLabel(c: Company) {
    if (c.subscriptionStatus === "active" && !c.stripeSubscriptionId) {
      return c.currentPeriodEnd
        ? `Comped until ${new Date(c.currentPeriodEnd).toLocaleDateString()}`
        : "Free forever";
    }
    if (c.subscriptionStatus === "active" && c.currentPeriodEnd) {
      return `Active · renews ${new Date(c.currentPeriodEnd).toLocaleDateString()}`;
    }
    return c.subscriptionStatus;
  }

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-xl font-semibold text-slate-900 mb-1">Super Admin</h1>
      <p className="text-sm text-slate-500 mb-6">
        Every company on the platform. Pending companies signed up via the public site and are awaiting activation.
      </p>

      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100 mb-8">
        {companies.map((c) => (
          <div key={c.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-slate-900">{c.name}</div>
              <div className="text-xs text-slate-400">
                {c.customDomain || "no custom domain"} · created {new Date(c.createdAt).toLocaleDateString()}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <span className={`text-xs font-medium rounded-full px-2.5 py-1 ${statusColor[c.status]}`}>{c.status}</span>
              <span className={`text-xs font-medium rounded-full px-2.5 py-1 ${subStatusColor[c.subscriptionStatus]}`}>
                {subStatusLabel(c)}
              </span>
              <select
                value={c.plan}
                onChange={(e) => setPlan(c.id, e.target.value)}
                className="rounded-md border border-slate-200 px-2 py-1.5 text-xs capitalize"
              >
                {PLAN_OPTIONS.includes(c.plan) ? null : <option value={c.plan}>{c.plan}</option>}
                {PLAN_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={0}
                placeholder="Years"
                value={grantYears[c.id] || ""}
                onChange={(e) => setGrantYears((prev) => ({ ...prev, [c.id]: e.target.value }))}
                className="w-16 rounded-md border border-slate-200 px-2 py-1.5 text-xs"
                title="0 or blank = no expiry"
              />
              <button
                onClick={() => grantFreeAccess(c.id)}
                disabled={granting === c.id}
                className="text-xs font-medium text-white bg-indigo-600 rounded-md px-3 py-1.5 disabled:opacity-40"
                title="Activates on the current plan with no Stripe subscription — 0 or blank years means it never expires"
              >
                {granting === c.id ? "Granting…" : "Grant Free Access"}
              </button>
              {c.status !== "active" && (
                <button
                  onClick={() => setStatus(c.id, "active")}
                  className="text-xs font-medium text-white bg-emerald-600 rounded-md px-3 py-1.5"
                >
                  Activate
                </button>
              )}
              {c.status !== "suspended" && (
                <button
                  onClick={() => setStatus(c.id, "suspended")}
                  className="text-xs font-medium text-red-600 bg-red-50 rounded-md px-3 py-1.5"
                >
                  Suspend
                </button>
              )}
            </div>
          </div>
        ))}
        {companies.length === 0 && <div className="p-4 text-sm text-slate-400">No companies yet.</div>}
      </div>

      <h2 className="text-sm font-semibold text-slate-700 mb-3">Add a company manually</h2>
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="grid grid-cols-2 gap-3">
          <input
            placeholder="Company name"
            value={form.companyName}
            onChange={(e) => setForm({ ...form, companyName: e.target.value })}
            className="rounded-md border border-slate-200 px-3 py-2 text-sm"
          />
          <select
            value={form.plan}
            onChange={(e) => setForm({ ...form, plan: e.target.value })}
            className="rounded-md border border-slate-200 px-3 py-2 text-sm capitalize"
          >
            {PLAN_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <input
            placeholder="Admin name"
            value={form.adminName}
            onChange={(e) => setForm({ ...form, adminName: e.target.value })}
            className="rounded-md border border-slate-200 px-3 py-2 text-sm"
          />
          <input
            placeholder="Admin email"
            value={form.adminEmail}
            onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
            className="rounded-md border border-slate-200 px-3 py-2 text-sm"
          />
          <input
            placeholder="Temporary password"
            type="password"
            value={form.adminPassword}
            onChange={(e) => setForm({ ...form, adminPassword: e.target.value })}
            className="rounded-md border border-slate-200 px-3 py-2 text-sm"
          />
          <input
            type="number"
            min={0}
            placeholder="Free years (blank = normal 7-day trial)"
            value={form.freeYears}
            onChange={(e) => setForm({ ...form, freeYears: e.target.value })}
            className="rounded-md border border-slate-200 px-3 py-2 text-sm col-span-2"
          />
        </div>
        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
        <button
          onClick={addCompany}
          disabled={submitting}
          className="mt-3 bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-40"
        >
          {submitting ? "Creating…" : "Create Company"}
        </button>
      </div>
    </div>
  );
}

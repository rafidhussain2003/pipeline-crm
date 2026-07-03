"use client";

import { useEffect, useState } from "react";

type Company = {
  id: string;
  name: string;
  status: string;
  plan: string;
  customDomain: string | null;
  customDomainVerified: boolean;
  createdAt: string;
};

export default function SuperAdminPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [form, setForm] = useState({ companyName: "", adminName: "", adminEmail: "", adminPassword: "", plan: "starter" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

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

  async function addCompany() {
    setError("");
    setSubmitting(true);
    const res = await fetch("/api/super-admin/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(data.error || "Something went wrong");
      return;
    }
    setForm({ companyName: "", adminName: "", adminEmail: "", adminPassword: "", plan: "starter" });
    load();
  }

  const statusColor: Record<string, string> = {
    pending: "bg-amber-50 text-amber-700",
    active: "bg-emerald-50 text-emerald-700",
    suspended: "bg-red-50 text-red-700",
  };

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-xl font-semibold text-slate-900 mb-1">Super Admin</h1>
      <p className="text-sm text-slate-500 mb-6">
        Every company on the platform. Pending companies signed up via the public site and are awaiting activation.
      </p>

      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100 mb-8">
        {companies.map((c) => (
          <div key={c.id} className="p-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-medium text-slate-900">{c.name}</div>
              <div className="text-xs text-slate-400">
                {c.plan} plan · {c.customDomain || "no custom domain"} · created {new Date(c.createdAt).toLocaleDateString()}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`text-xs font-medium rounded-full px-2.5 py-1 ${statusColor[c.status]}`}>{c.status}</span>
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
            className="rounded-md border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="starter">Starter</option>
            <option value="growth">Growth</option>
            <option value="scale">Scale</option>
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

"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

// Phase 4A — company detail + edit.
//
// Edits COMPANY attributes only. No user record, login email or credential is
// reachable from this page — that is deliberate and belongs to a later phase.

type Company = {
  id: string;
  name: string;
  slug: string | null;
  status: string;
  plan: string | null;
  subscriptionStatus: string | null;
  supportEmail: string | null;
  businessPhone: string | null;
  address: string | null;
  website: string | null;
  timezone: string | null;
  seats: number | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  createdAt: string;
  updatedAt: string | null;
};
type Owner = { name: string; email: string } | null;

const EDITABLE = ["name", "supportEmail", "businessPhone", "address", "website", "timezone", "plan", "status"] as const;
type Field = (typeof EDITABLE)[number];
type Form = Record<Field, string>;

const STATUSES = ["active", "suspended", "pending"];
const PLANS = ["free", "starter", "growth", "premium"];

const toForm = (c: Company): Form => ({
  name: c.name ?? "",
  supportEmail: c.supportEmail ?? "",
  businessPhone: c.businessPhone ?? "",
  address: c.address ?? "",
  website: c.website ?? "",
  timezone: c.timezone ?? "",
  plan: c.plan ?? "",
  status: c.status ?? "",
});

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [company, setCompany] = useState<Company | null>(null);
  const [owner, setOwner] = useState<Owner>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [baseline, setBaseline] = useState<Form | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/super-admin/companies/${id}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Could not load this company (${res.status})`);
      const data = await res.json();
      setCompany(data.company);
      setOwner(data.owner);
      setForm(toForm(data.company));
      setBaseline(toForm(data.company));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this company");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const dirty = !!form && !!baseline && EDITABLE.some((k) => form[k] !== baseline[k]);

  // Unsaved-changes warning. Covers reload/close; in-app navigation is guarded
  // by the Cancel button returning to a clean state.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  async function save() {
    if (!form || !baseline) return;
    setSaving(true);
    setError("");
    setSuccess("");
    // Send only what changed — a PATCH that echoes every field would make the
    // audit diff meaningless and could clobber a concurrent edit.
    const patch: Record<string, string> = {};
    for (const k of EDITABLE) if (form[k] !== baseline[k]) patch[k] = form[k];
    try {
      const res = await fetch(`/api/super-admin/companies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not save changes");
      setCompany(data.company);
      setForm(toForm(data.company));
      setBaseline(toForm(data.company));
      setSuccess("Company updated.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save changes");
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    if (baseline) setForm({ ...baseline });
    setError("");
    setSuccess("");
  }

  if (loading) return <div className="p-6 text-sm text-slate-400">Loading company…</div>;
  if (!company || !form) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-700 mb-3">{error || "Company not found."}</p>
        <Link href="/super-admin/companies" className="text-sm font-medium text-blue-700 hover:underline">
          ← Back to Company Management
        </Link>
      </div>
    );
  }

  const set = (k: Field) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => (f ? { ...f, [k]: e.target.value } : f));

  const Text = ({ k, label, type = "text" }: { k: Field; label: string; type?: string }) => (
    <div>
      <label htmlFor={k} className="block text-xs font-medium text-slate-600 mb-1">
        {label}
      </label>
      <input
        id={k}
        type={type}
        value={form[k]}
        onChange={set(k)}
        className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );

  return (
    <div className="p-6 max-w-3xl">
      <Link href="/super-admin/companies" className="text-sm text-blue-700 hover:underline">
        ← Company Management
      </Link>
      <h1 className="text-xl font-semibold text-slate-900 mt-2 mb-1">{company.name}</h1>
      <p className="text-xs font-mono text-slate-400 mb-6">{company.id}</p>

      {error && (
        <div role="alert" className="mb-4 text-sm bg-red-50 border border-red-100 text-red-800 rounded-md px-3 py-2">
          {error}
        </div>
      )}
      {success && (
        <div role="status" className="mb-4 text-sm bg-emerald-50 border border-emerald-100 text-emerald-800 rounded-md px-3 py-2">
          {success}
        </div>
      )}

      {/* Read-only administrative metadata. Owner is derived from the company's
          oldest admin user and is NOT editable here — Phase 4A does not modify
          user records or authentication identities. */}
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-6">
        <div className="text-xs font-semibold text-slate-500 mb-3">Administrative metadata (read-only)</div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          {[
            ["Company Owner", owner ? `${owner.name} (${owner.email})` : "—"],
            ["Subscription status", company.subscriptionStatus || "—"],
            ["Seats", company.seats != null ? String(company.seats) : "—"],
            ["Slug", company.slug || "—"],
            ["Trial ends", company.trialEndsAt ? new Date(company.trialEndsAt).toLocaleDateString() : "—"],
            ["Period end", company.currentPeriodEnd ? new Date(company.currentPeriodEnd).toLocaleDateString() : "—"],
            ["Created", new Date(company.createdAt).toLocaleString()],
            ["Updated", company.updatedAt ? new Date(company.updatedAt).toLocaleString() : "—"],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <dt className="text-slate-400">{k}</dt>
              <dd className="text-slate-700 text-right">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="text-sm font-semibold text-slate-900 mb-4">Company details</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Text k="name" label="Company Name" />
          <Text k="supportEmail" label="Contact Email" type="email" />
          <Text k="businessPhone" label="Business Phone" />
          <Text k="website" label="Website" />
          <Text k="timezone" label="Timezone" />
          <div>
            <label htmlFor="plan" className="block text-xs font-medium text-slate-600 mb-1">
              Subscription / Plan
            </label>
            <select id="plan" value={form.plan} onChange={set("plan")} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
              {[...new Set([form.plan, ...PLANS].filter(Boolean))].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="status" className="block text-xs font-medium text-slate-600 mb-1">
              Status
            </label>
            <select id="status" value={form.status} onChange={set("status")} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
              {[...new Set([form.status, ...STATUSES].filter(Boolean))].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="address" className="block text-xs font-medium text-slate-600 mb-1">
              Address
            </label>
            <textarea
              id="address"
              value={form.address}
              onChange={set("address")}
              rows={2}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 mt-5 pt-4 border-t border-slate-100">
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          <button
            onClick={cancel}
            disabled={!dirty || saving}
            className="text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-md px-4 py-2 disabled:opacity-40"
          >
            Cancel
          </button>
          {dirty && <span className="text-xs text-amber-700">Unsaved changes</span>}
        </div>
      </div>
    </div>
  );
}

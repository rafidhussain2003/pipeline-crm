"use client";

import { useCallback, useEffect, useState } from "react";

// Commercial Sales — the ADMIN-ONLY sheet, ONE-WAY from the main ledger: it
// pulls every "Commercial" sale and its status from the main ledger, but
// nothing the admin changes here (status, add-ons, funds, anything) ever goes
// back to the main ledger, and an admin edit here is never overwritten by the
// pull. Own compact format (per the reference sheet), Excel-style grid, green
// header.

const STATUSES = [
  { value: "active", label: "Active" },
  { value: "pending", label: "Pending" },
  { value: "cancelled", label: "Cancelled" },
  { value: "follow_up", label: "Follow-up" },
] as const;
const STATUS_LABEL: Record<string, string> = Object.fromEntries(STATUSES.map((s) => [s.value, s.label]));
const STATUS_ROW: Record<string, string> = {
  active: "bg-green-500",
  pending: "bg-amber-50",
  cancelled: "bg-red-500",
  follow_up: "bg-yellow-300",
};

type Row = {
  id: string;
  // Set = originally caught from a main-ledger sale; null = added directly on
  // this sheet. Either way the row is independent and owns its data.
  saleId: string | null;
  addOns: string | null;
  fundsStatus: string | null;
  orderDate: string | null;
  customerName: string | null;
  product: string | null;
  activationStatus: string;
};

export default function CommercialSalesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/sales/commercial");
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Could not load (${res.status})`);
      const data = await res.json();
      setRows(data.rows || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load commercial sales");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Every field on every row → the commercial row's own PATCH.
  async function patchCommercial(id: string, field: string, value: unknown) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
    const res = await fetch(`/api/sales/commercial/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || "Could not save");
    load({ silent: true });
  }
  // Every field on every row edits the COMMERCIAL row itself — this sheet is
  // independent of the main ledger. (It used to route linked rows' edits to
  // the main-ledger sale and then re-read the sale's status, which snapped an
  // admin's status change back within a second.)
  async function patchData(r: Row, field: string, value: unknown) {
    return patchCommercial(r.id, field, value);
  }
  // Admin adds a commercial sale directly ON this sheet: a STANDALONE row that
  // exists only here — the main Sales Ledger never sees it. Appears at the
  // bottom immediately; fill the cells inline.
  async function addSale() {
    const res = await fetch("/api/sales/commercial", { method: "POST" });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Could not add");
      return;
    }
    load({ silent: true });
  }

  // Remove a row from this sheet. The main Sales Ledger is never affected —
  // this sheet is independent; Remove is the ONLY way a row leaves it.
  async function removeRow(r: Row) {
    if (!confirm("Remove this sale from the Commercial Sales sheet? (The main Sales Ledger is not affected.)")) return;
    await fetch(`/api/sales/commercial/${r.id}`, { method: "DELETE" });
    load({ silent: true });
  }

  if (forbidden) {
    return <div className="p-6 text-sm text-slate-500">Only an admin can view Commercial Sales.</div>;
  }

  // Status totals for the chips on top — derived from the loaded rows, so they
  // update instantly when a status is changed here.
  const counts = rows.reduce(
    (acc, r) => {
      if (r.activationStatus === "active") acc.active++;
      else if (r.activationStatus === "pending") acc.pending++;
      else if (r.activationStatus === "cancelled") acc.cancelled++;
      else if (r.activationStatus === "follow_up") acc.follow_up++;
      return acc;
    },
    { active: 0, pending: 0, cancelled: 0, follow_up: 0 }
  );

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Commercial Sales</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Pulls every “Commercial” sale and its status from the main ledger (one-way). Anything you change here stays here — it never goes back to the main ledger, and it won’t be overwritten. Admin-only.
          </p>
        </div>
        <button onClick={addSale} className="text-sm font-semibold text-white bg-green-700 hover:bg-green-800 rounded-md px-3 py-2">
          + Add sale
        </button>
      </div>

      {/* Status totals — the same chips as the main Sales Ledger. */}
      {!loading && (
        <div className="flex flex-wrap gap-2 mb-4 text-xs">
          <Stat label="Total" value={rows.length} tone="text-slate-700 bg-slate-100" />
          <Stat label="Active" value={counts.active} tone="text-emerald-800 bg-emerald-100" />
          <Stat label="Pending" value={counts.pending} tone="text-amber-800 bg-amber-100" />
          <Stat label="Cancelled" value={counts.cancelled} tone="text-red-800 bg-red-100" />
          <Stat label="Follow-up" value={counts.follow_up} tone="text-yellow-800 bg-yellow-100" />
        </div>
      )}

      {error && (
        <div role="alert" className="mb-3 flex items-center justify-between gap-3 text-sm bg-red-50 border border-red-100 text-red-800 rounded-md px-3 py-2">
          <span>{error}</span>
          <button onClick={() => setError("")} className="text-red-700">×</button>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto print:border-0">
        <table className="w-full text-sm border-collapse [&_th]:border [&_td]:border [&_th]:border-green-800 [&_td]:border-slate-200">
          <thead>
            {/* Dark green header — the commercial sheet's own look (reference sheet). */}
            <tr className="bg-green-700 text-left text-[11px] font-semibold text-white uppercase tracking-wide">
              <th className="px-2 py-2.5 w-10 text-center">#</th>
              <th className="px-2 py-2.5">Customer Name</th>
              <th className="px-2 py-2.5">Date</th>
              <th className="px-2 py-2.5">Product Sold</th>
              <th className="px-2 py-2.5">Status</th>
              <th className="px-2 py-2.5">Add Ons</th>
              <th className="px-2 py-2.5">Funds Status</th>
              <th className="px-2 py-2.5 print:hidden"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">Loading…</td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                  No commercial sales yet — mark a sale as Commercial on the Sales Ledger and it appears here.
                </td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={r.id} className={`border-b border-slate-100 ${STATUS_ROW[r.activationStatus] || ""}`}>
                <Td className="text-center tabular-nums bg-yellow-200 text-slate-700 font-medium">{i + 1}</Td>
                <Td><Cell value={r.customerName} onSave={(v) => patchData(r, "customerName", v)} /></Td>
                <Td><Cell value={r.orderDate} onSave={(v) => patchData(r, "orderDate", v)} /></Td>
                <Td><Cell value={r.product} onSave={(v) => patchData(r, "product", v)} /></Td>
                <Td>
                  <select
                    value={r.activationStatus}
                    onChange={(e) => patchData(r, "activationStatus", e.target.value)}
                    className="bg-transparent text-sm font-medium focus:outline-none"
                  >
                    {STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                    {!STATUS_LABEL[r.activationStatus] && <option value={r.activationStatus}>{r.activationStatus}</option>}
                  </select>
                </Td>
                <Td><Cell value={r.addOns} onSave={(v) => patchCommercial(r.id, "addOns", v)} /></Td>
                <Td><Cell value={r.fundsStatus} onSave={(v) => patchCommercial(r.id, "fundsStatus", v)} /></Td>
                <Td className="print:hidden text-right">
                  <button onClick={() => removeRow(r)} className="text-[11px] font-medium text-red-600 bg-red-50 rounded px-2 py-1">
                    Remove
                  </button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${tone}`}>
      {label} <span className="font-bold">{value}</span>
    </span>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-2 py-1.5 align-top ${className}`}>{children}</td>;
}

// Click-to-edit text cell (same behavior as the main ledger's).
function Cell({ value, onSave }: { value: string | null; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value ?? "");
  useEffect(() => {
    setV(value ?? "");
  }, [value]);
  if (!editing)
    return (
      <button onClick={() => setEditing(true)} className="block w-full text-left text-slate-800 hover:bg-slate-100/70 rounded px-1 py-0.5 min-h-[24px] whitespace-pre-wrap break-words">
        {value || <span className="text-slate-300">—</span>}
      </button>
    );
  return (
    <input
      autoFocus
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (v !== (value ?? "")) onSave(v);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setV(value ?? "");
          setEditing(false);
        }
      }}
      className="w-full rounded border border-blue-400 px-1 py-0.5 text-sm focus:outline-none"
    />
  );
}

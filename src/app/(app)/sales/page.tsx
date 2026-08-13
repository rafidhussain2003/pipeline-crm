"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Sales Ledger — a live, spreadsheet-style replacement for the external Excel
// sheet. Deliberately plain: rows, columns, click-to-edit cells, color by
// status. Agents see only their own rows (and lose detail after the admin's
// monthly cutoff); admins/managers see the whole company master.

const STATUSES = [
  { value: "active", label: "Active" },
  { value: "pending", label: "Pending" },
  { value: "cancelled", label: "Cancelled" },
  { value: "follow_up", label: "Follow-up" },
] as const;
const STATUS_LABEL: Record<string, string> = Object.fromEntries(STATUSES.map((s) => [s.value, s.label]));
// Whole-row color by activation status, at a strong, saturated Excel-like
// strength: active → dark green, cancelled → dark red, follow-up → vivid
// yellow; pending stays a neutral light amber (the default "not yet actioned"
// state). Dark cell text stays legible on all of these.
const STATUS_ROW: Record<string, string> = {
  active: "bg-green-500",
  pending: "bg-amber-50",
  cancelled: "bg-red-500",
  follow_up: "bg-yellow-300",
};

type Row = {
  id: string;
  agentId: string;
  agentName: string | null;
  orderDate: string | null;
  installationDate: string | null;
  customerName: string | null;
  phone: string | null;
  product: string | null;
  autopay: boolean;
  isCommercial: boolean;
  activationStatus: string;
  notes: string | null;
  deletedAt: string | null;
  createdAt: string;
};
type Summary = { total: number; active: number; pending: number; cancelled: number; follow_up: number };
type ProductCount = { key: string; label: string; count: number };
type Meta = {
  month: string;
  viewAll: boolean;
  canEdit: boolean;
  canManage: boolean;
  canExport: boolean;
  summaryOnly: boolean;
  summary: Summary;
  agents: { id: string; name: string }[];
  productCounts?: ProductCount[];
  pageSize?: number;
};

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
// Was this row created today? Agents may adjust the two toggles (Autopay /
// Commercial) only during the posting day; text fields lock the moment they
// hold a value. Mirrors the server rule (which is authoritative).
function createdToday(iso: string): boolean {
  const c = new Date(iso);
  const n = new Date();
  return c.getFullYear() === n.getFullYear() && c.getMonth() === n.getMonth() && c.getDate() === n.getDate();
}
const filled = (v: string | null) => v !== null && v.trim() !== "";
function monthLabel(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
}

export default function SalesLedgerPage() {
  const [month, setMonth] = useState(currentMonth());
  const [months, setMonths] = useState<string[]>([currentMonth()]);
  const [rows, setRows] = useState<Row[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [agentId, setAgentId] = useState("");
  const [product, setProduct] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const [visibleUntil, setVisibleUntil] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      setError("");
      const p = new URLSearchParams({ month, page: String(page) });
      if (search) p.set("search", search);
      if (status) p.set("status", status);
      if (agentId) p.set("agentId", agentId);
      if (product) p.set("product", product);
      if (showDeleted) p.set("deleted", "1");
      try {
        const res = await fetch(`/api/sales?${p}`);
        if (res.status === 403) {
          setForbidden(true);
          return;
        }
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Could not load (${res.status})`);
        const data = await res.json();
        setRows(data.rows || []);
        setTotal(data.total ?? 0);
        setMeta(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load sales");
      } finally {
        setLoading(false);
      }
    },
    [month, page, search, status, agentId, product, showDeleted]
  );

  // Debounced reload on any query change (search feels instant, no page reload).
  const first = useRef(true);
  useEffect(() => {
    const t = setTimeout(load, first.current ? 0 : 250);
    first.current = false;
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    fetch("/api/sales/months")
      .then((r) => (r.ok ? r.json() : { months: [] }))
      .then((d) => d.months?.length && setMonths(d.months))
      .catch(() => {});
  }, []);

  // Reset page + load the admin visibility control when the month changes.
  useEffect(() => {
    setPage(1);
  }, [month, search, status, agentId, product, showDeleted]);
  useEffect(() => {
    if (!meta?.canManage) return;
    fetch(`/api/sales/period?month=${month}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setVisibleUntil(d?.agentVisibleUntil ? d.agentVisibleUntil.slice(0, 10) : null))
      .catch(() => {});
  }, [month, meta?.canManage]);

  async function patchCell(id: string, field: string, value: unknown) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
    const res = await fetch(`/api/sales/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Could not save");
      load({ silent: true });
    } else {
      load({ silent: true }); // refresh summary counts
    }
  }

  async function addSale() {
    const res = await fetch("/api/sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(meta?.viewAll ? { month } : {}),
    });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Could not add");
      return;
    }
    load({ silent: true });
  }

  async function removeSale(id: string) {
    await fetch(`/api/sales/${id}`, { method: "DELETE" });
    load({ silent: true });
  }
  async function restoreSale(id: string) {
    await fetch(`/api/sales/${id}/restore`, { method: "POST" });
    load({ silent: true });
  }
  async function saveVisibility(dateStr: string) {
    setVisibleUntil(dateStr || null);
    await fetch("/api/sales/period", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      // End-of-day so "visible until the 15th" includes all of the 15th.
      body: JSON.stringify({ month, agentVisibleUntil: dateStr ? `${dateStr}T23:59:59` : null }),
    });
    load({ silent: true });
  }

  if (forbidden) {
    return <div className="p-6 text-sm text-slate-500">You do not have access to the Sales Ledger.</div>;
  }

  const canAdd = meta?.canEdit && (meta.viewAll || month === currentMonth());
  const summary = meta?.summary;
  // The monthly sheet holds up to this many rows before a second page appears.
  const pageSize = meta?.pageSize ?? 500;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="p-6">
      {/* Header: title + month switcher + live status totals */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Sales Ledger</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {meta?.viewAll ? "Your company's master sales sheet." : "Your sales."} Click any cell to edit.
          </p>
        </div>
        <select value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium">
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
      </div>

      {summary && (
        <div className="flex flex-wrap gap-2 mb-4 text-xs">
          <Stat label="Total" value={summary.total} tone="text-slate-700 bg-slate-100" />
          <Stat label="Active" value={summary.active} tone="text-emerald-800 bg-emerald-100" />
          <Stat label="Pending" value={summary.pending} tone="text-amber-800 bg-amber-100" />
          <Stat label="Cancelled" value={summary.cancelled} tone="text-red-800 bg-red-100" />
          <Stat label="Follow-up" value={summary.follow_up} tone="text-yellow-800 bg-yellow-100" />
        </div>
      )}

      {/* Product-family filter chips — click one to filter the sheet to that
          product (Dish, AT&T, Frontier, Xfinity, …); each shows its total for
          the month. Click again (or "All") to clear. */}
      {meta?.productCounts && meta.productCounts.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-4">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mr-1">Products</span>
          <ProductChip label="All" count={summary?.total ?? 0} active={product === ""} onClick={() => setProduct("")} />
          {meta.productCounts.map((pc) => (
            <ProductChip
              key={pc.key}
              label={pc.label}
              count={pc.count}
              active={product === pc.key}
              onClick={() => setProduct(product === pc.key ? "" : pc.key)}
            />
          ))}
        </div>
      )}

      {error && (
        <div role="alert" className="mb-3 flex items-center justify-between gap-3 text-sm bg-red-50 border border-red-100 text-red-800 rounded-md px-3 py-2">
          <span>{error}</span>
          <button onClick={() => setError("")} className="text-red-700">×</button>
        </div>
      )}

      {/* Agent, past the month cutoff → summary only, no detail. */}
      {meta?.summaryOnly ? (
        <div className="bg-white border border-slate-200 rounded-lg p-6 max-w-md">
          <div className="text-sm font-semibold text-slate-700 mb-1">{monthLabel(month)} — summary</div>
          <p className="text-xs text-slate-400 mb-4">Detailed customer information for this month is no longer available.</p>
          <div className="grid grid-cols-2 gap-3">
            {summary &&
              [
                ["Total sales", summary.total],
                ["Activated", summary.active],
                ["Cancelled", summary.cancelled],
                ["Pending", summary.pending + summary.follow_up],
              ].map(([l, v]) => (
                <div key={l} className="bg-slate-50 rounded-md p-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">{l}</div>
                  <div className="text-lg font-semibold text-slate-800 mt-0.5">{v}</div>
                </div>
              ))}
          </div>
        </div>
      ) : (
        <>
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, phone, product, notes"
              className="flex-1 min-w-[200px] max-w-sm rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-md border border-slate-200 px-2 py-2 text-sm">
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            {meta?.viewAll && (
              <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="rounded-md border border-slate-200 px-2 py-2 text-sm">
                <option value="">All agents</option>
                {meta.agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
            {canAdd && (
              <button onClick={addSale} className="text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md px-3 py-2">
                + Add sale
              </button>
            )}
            {meta?.canExport && (
              <div className="flex items-center gap-1.5 ml-auto">
                <a href={`/api/sales/export?month=${month}&format=csv`} className="text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md px-2.5 py-2">CSV</a>
                <a href={`/api/sales/export?month=${month}&format=xls`} className="text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md px-2.5 py-2">Excel</a>
                <button onClick={() => window.print()} className="text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md px-2.5 py-2">Print</button>
              </div>
            )}
          </div>

          {/* Admin: per-month agent visibility cutoff + show-deleted */}
          {meta?.canManage && (
            <div className="flex flex-wrap items-center gap-3 mb-3 text-xs text-slate-600">
              <label className="flex items-center gap-1.5">
                <span>Agents can see {monthLabel(month)} detail until</span>
                <input type="date" value={visibleUntil ?? ""} onChange={(e) => saveVisibility(e.target.value)} className="rounded-md border border-slate-200 px-2 py-1" />
                {visibleUntil && (
                  <button onClick={() => saveVisibility("")} className="text-slate-400 hover:text-slate-600" title="Always visible">clear</button>
                )}
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} className="rounded border-slate-300" />
                Show deleted
              </label>
            </div>
          )}

          {/* The sheet */}
          <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto print:border-0">
            {/* Excel-style grid: light, clean gridlines on every cell via the
                border-collapse + per-th/td border utilities (not heavy). */}
            <table className="w-full text-sm border-collapse [&_th]:border [&_td]:border [&_th]:border-slate-200 [&_td]:border-slate-200">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                  <th className="px-2 py-2.5 w-10 text-center bg-yellow-100">#</th>
                  <th className="px-2 py-2.5">Order Date</th>
                  <th className="px-2 py-2.5">Installation Date</th>
                  <th className="px-2 py-2.5">Customer Name</th>
                  <th className="px-2 py-2.5">Phone</th>
                  <th className="px-2 py-2.5">Product</th>
                  <th className="px-2 py-2.5">Autopay</th>
                  <th className="px-2 py-2.5">Commercial</th>
                  <th className="px-2 py-2.5">Activation Status</th>
                  <th className="px-2 py-2.5 min-w-[220px]">Notes</th>
                  {meta?.viewAll && <th className="px-2 py-2.5">Agent</th>}
                  {meta?.canManage && <th className="px-2 py-2.5 print:hidden"></th>}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={12} className="px-4 py-8 text-center text-slate-400">Loading…</td>
                  </tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={12} className="px-4 py-8 text-center text-slate-400">No sales yet{canAdd ? " — click “+ Add sale”." : "."}</td>
                  </tr>
                )}
                {rows.map((r, i) => {
                  const deleted = !!r.deletedAt;
                  // Agent field-lock (admin/manager are never locked): a text
                  // cell is editable only while EMPTY — once saved it's fixed;
                  // the two toggles are editable only on the posting day.
                  // Activation Status stays editable for the life of the sale.
                  const lockText = (v: string | null) => !meta?.canEdit || deleted || (!meta?.viewAll && filled(v));
                  const lockToggle = !meta?.canEdit || deleted || (!meta?.viewAll && !createdToday(r.createdAt));
                  return (
                    <tr key={r.id} className={`border-b border-slate-100 ${deleted ? "opacity-50" : STATUS_ROW[r.activationStatus] || ""}`}>
                      {/* Serial number — always a yellow box (like a spreadsheet
                          row gutter); follows the current filtered/sorted, paginated view. */}
                      <Td className="text-center tabular-nums bg-yellow-200 text-slate-700 font-medium">{(page - 1) * pageSize + i + 1}</Td>
                      <Td><Cell value={r.orderDate} disabled={lockText(r.orderDate)} onSave={(v) => patchCell(r.id, "orderDate", v)} /></Td>
                      <Td><Cell value={r.installationDate} disabled={lockText(r.installationDate)} onSave={(v) => patchCell(r.id, "installationDate", v)} /></Td>
                      <Td><Cell value={r.customerName} disabled={lockText(r.customerName)} onSave={(v) => patchCell(r.id, "customerName", v)} /></Td>
                      <Td><Cell value={r.phone} disabled={lockText(r.phone)} onSave={(v) => patchCell(r.id, "phone", v)} /></Td>
                      <Td><Cell value={r.product} disabled={lockText(r.product)} onSave={(v) => patchCell(r.id, "product", v)} /></Td>
                      <Td>
                        <button
                          disabled={lockToggle}
                          onClick={() => patchCell(r.id, "autopay", !r.autopay)}
                          className={`text-xs font-medium rounded px-2 py-0.5 ${r.autopay ? "text-emerald-800 bg-emerald-100" : "text-slate-500 bg-slate-100"} disabled:opacity-60`}
                        >
                          {r.autopay ? "Yes" : "No"}
                        </button>
                      </Td>
                      <Td>
                        {/* Mark as commercial while posting → the sale is caught
                            into the admin-only Commercial Sales sheet. */}
                        <button
                          disabled={lockToggle}
                          onClick={() => patchCell(r.id, "isCommercial", !r.isCommercial)}
                          className={`text-xs font-medium rounded px-2 py-0.5 ${r.isCommercial ? "text-violet-800 bg-violet-100" : "text-slate-500 bg-slate-100"} disabled:opacity-60`}
                        >
                          {r.isCommercial ? "Yes" : "No"}
                        </button>
                      </Td>
                      <Td>
                        <select
                          disabled={!meta?.canEdit || deleted}
                          value={r.activationStatus}
                          onChange={(e) => patchCell(r.id, "activationStatus", e.target.value)}
                          className="bg-transparent text-sm font-medium focus:outline-none disabled:opacity-70"
                        >
                          {STATUSES.map((s) => (
                            <option key={s.value} value={s.value}>
                              {s.label}
                            </option>
                          ))}
                          {!STATUS_LABEL[r.activationStatus] && <option value={r.activationStatus}>{r.activationStatus}</option>}
                        </select>
                      </Td>
                      <Td><Cell value={r.notes} disabled={lockText(r.notes)} onSave={(v) => patchCell(r.id, "notes", v)} /></Td>
                      {meta?.viewAll && <Td><span className="text-slate-800">{r.agentName || "—"}</span></Td>}
                      {meta?.canManage && (
                        <Td className="print:hidden text-right">
                          {deleted ? (
                            <button onClick={() => restoreSale(r.id)} className="text-[11px] font-medium text-emerald-700 bg-emerald-50 rounded px-2 py-1">Restore</button>
                          ) : (
                            <button onClick={() => removeSale(r.id)} className="text-[11px] font-medium text-red-600 bg-red-50 rounded px-2 py-1">Delete</button>
                          )}
                        </Td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-3 text-sm text-slate-500 print:hidden">
              <span>{total.toLocaleString()} rows</span>
              <div className="flex items-center gap-2">
                <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1.5 rounded-md border border-slate-200 disabled:opacity-40">Prev</button>
                <span>Page {page} / {totalPages}</span>
                <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 rounded-md border border-slate-200 disabled:opacity-40">Next</button>
              </div>
            </div>
          )}
        </>
      )}
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

function ProductChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border transition-colors ${
        active ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
      }`}
    >
      {label} <span className={`font-bold ${active ? "text-white" : "text-slate-500"}`}>{count}</span>
    </button>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-2 py-1.5 align-top ${className}`}>{children}</td>;
}

// Click-to-edit text cell. Enter or blur saves; Escape cancels.
function Cell({ value, onSave, disabled }: { value: string | null; onSave: (v: string) => void; disabled?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value ?? "");
  useEffect(() => {
    setV(value ?? "");
  }, [value]);
  if (disabled) return <span className="block text-slate-700 whitespace-pre-wrap break-words">{value || <span className="text-slate-300">—</span>}</span>;
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

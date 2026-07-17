"use client";

import { useEffect, useState } from "react";
import { Badge, LEAVE_STATUS_STYLES, PageHeader } from "@/components/attendance/shared";

type Leave = {
  id: string; userId: string; userName: string; type: string; startDate: string; endDate: string;
  reason: string | null; status: string; reviewNote: string | null; createdAt: string;
};
type Balance = { type: string; usedDaysThisYear: number; annualAllowance: number | null };

const LEAVE_LABELS: Record<string, string> = { casual: "Casual", sick: "Sick", paid: "Paid", unpaid: "Unpaid", emergency: "Emergency" };

export default function LeavePage() {
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");

  const load = async (all = showAll) => {
    const res = await fetch(`/api/attendance/leaves${all ? "?all=1" : ""}`);
    if (res.ok) {
      const d = await res.json();
      setLeaves(d.leaves || []);
      setBalances(d.balances || []);
      setCanManage(!!d.canManage);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [showAll]);

  async function act(id: string, action: "approve" | "reject" | "cancel") {
    setError("");
    const res = await fetch(`/api/attendance/leaves/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || "Action failed");
    load();
  }

  return (
    <div className="p-6 max-w-4xl">
      <PageHeader
        title="Leave Management"
        subtitle="Request leave and track approvals."
        action={<button onClick={() => setShowForm(true)} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">Request leave</button>}
      />
      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
        {balances.map((b) => (
          <div key={b.type} className="bg-white border border-slate-200 rounded-lg p-3">
            <div className="text-[11px] uppercase tracking-wide text-slate-400">{LEAVE_LABELS[b.type] || b.type}</div>
            <div className="text-sm font-semibold text-slate-800 mt-0.5">
              {b.usedDaysThisYear} used
              <span className="text-[11px] font-normal text-slate-400"> / {b.annualAllowance ?? "—"} allowed</span>
            </div>
          </div>
        ))}
      </div>

      {canManage && (
        <div className="flex gap-1.5 mb-3">
          <button onClick={() => setShowAll(false)} className={`text-xs font-medium rounded-full px-3 py-1 ${!showAll ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}>My requests</button>
          <button onClick={() => setShowAll(true)} className={`text-xs font-medium rounded-full px-3 py-1 ${showAll ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}>Whole company</button>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {leaves.map((l) => (
          <div key={l.id} className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-900 truncate">
                {showAll ? `${l.userName} — ` : ""}{LEAVE_LABELS[l.type] || l.type} leave
              </div>
              <div className="text-xs text-slate-400">
                {l.startDate}{l.endDate !== l.startDate ? ` → ${l.endDate}` : ""}{l.reason ? ` · ${l.reason}` : ""}{l.reviewNote ? ` · Note: ${l.reviewNote}` : ""}
              </div>
            </div>
            <Badge value={l.status} styles={LEAVE_STATUS_STYLES} />
            <div className="flex gap-1.5 shrink-0">
              {canManage && showAll && l.status === "pending" && (
                <>
                  <button onClick={() => act(l.id, "approve")} className="text-[11px] font-medium text-emerald-700 bg-emerald-50 rounded px-2 py-1">Approve</button>
                  <button onClick={() => act(l.id, "reject")} className="text-[11px] font-medium text-red-600 bg-red-50 rounded px-2 py-1">Reject</button>
                </>
              )}
              {(l.status === "pending" || l.status === "approved") && (
                <button onClick={() => act(l.id, "cancel")} className="text-[11px] font-medium text-slate-500 bg-slate-100 rounded px-2 py-1">Cancel</button>
              )}
            </div>
          </div>
        ))}
        {leaves.length === 0 && <p className="text-sm text-slate-400 px-4 py-8 text-center">No leave requests.</p>}
      </div>

      {showForm && <LeaveModal onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />}
    </div>
  );
}

function LeaveModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [type, setType] = useState("casual");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    const res = await fetch("/api/attendance/leaves", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, startDate, endDate, reason: reason || null }),
    });
    setSaving(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Could not submit");
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900 mb-4">Request leave</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Type</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
              {Object.entries(LEAVE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">From</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">To</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Reason (optional)</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={saving} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">
            {saving ? "Submitting…" : "Submit request"}
          </button>
        </div>
      </div>
    </div>
  );
}

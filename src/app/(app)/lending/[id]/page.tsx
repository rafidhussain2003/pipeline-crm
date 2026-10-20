"use client";

// Lending Bank → one loan: borrower, terms, and the EMI schedule with
// "Mark paid" per instalment (receipt emailed), undo, resend details, cancel.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { inr, inputCls, labelCls, LoanStatusBadge, shortDate, todayIso } from "@/components/finance/lending-shared";

type Loan = { id: string; loanNumber: number; borrowerName: string; borrowerPhone: string; borrowerEmail: string; principalCents: number; interestRate: string; tenureMonths: number; emiCents: number; totalInterestCents: number; totalPayableCents: number; startDate: string; firstDueDate: string; status: string; notes: string | null; lastEmailAt: string | null };
type Emi = { id: string; installmentNo: number; dueDate: string; emiCents: number; principalCents: number; interestCents: number; balanceAfterCents: number; status: string; paidOn: string | null; paidNote: string | null; reminderSentAt: string | null; dueNoticeSentAt: string | null };

export default function LoanPage() {
  const { id } = useParams<{ id: string }>();
  const [loan, setLoan] = useState<Loan | null>(null);
  const [emis, setEmis] = useState<Emi[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [paying, setPaying] = useState<Emi | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/lending/loans/${id}`);
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || "Loan not found"); return; }
    const data = await res.json();
    setLoan(data.loan);
    setEmis(data.emis || []);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function act(path: string, method: string, body?: unknown, okMessage?: string) {
    setBusy(true);
    setError("");
    setMessage("");
    const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error || "Something went wrong"); return false; }
    if (okMessage) setMessage(okMessage);
    await load();
    return data;
  }

  if (error && !loan) return <div className="p-6"><p className="text-sm text-red-600">{error}</p><Link href="/lending" className="text-sm text-blue-700 hover:underline">← Lending Bank</Link></div>;
  if (!loan) return <div className="p-6 text-sm text-slate-400">Loading…</div>;

  const today = todayIso();
  const paid = emis.filter((e) => e.status === "paid");
  const pending = emis.filter((e) => e.status === "pending");
  const collected = paid.reduce((s, e) => s + e.emiCents, 0);
  const nextPending = pending[0];

  return (
    <div className="p-6 max-w-4xl">
      <Link href="/lending" className="text-sm text-blue-700 hover:underline">← Lending Bank</Link>
      <div className="flex items-start justify-between gap-4 mt-2 mb-5">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 flex items-center gap-2">LN-{loan.loanNumber} · {loan.borrowerName} <LoanStatusBadge status={loan.status} overdue={pending.filter((e) => e.dueDate < today).length} /></h1>
          <p className="text-sm text-slate-500 mt-1">{loan.borrowerPhone} · {loan.borrowerEmail}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => act(`/api/lending/loans/${loan.id}/email`, "POST", {}, "Loan details emailed to the borrower.")} disabled={busy} className="text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 px-3 py-2 rounded-md disabled:opacity-50">Email loan details</button>
          {loan.status === "active" && paid.length === 0 && (
            <button onClick={() => { if (confirm("Cancel this loan? The amount returns to the bank balance.")) act(`/api/lending/loans/${loan.id}/cancel`, "POST", {}, "Loan cancelled."); }} disabled={busy} className="text-sm font-medium text-red-600 bg-red-50 px-3 py-2 rounded-md disabled:opacity-50">Cancel loan</button>
          )}
        </div>
      </div>
      {message && <p className="text-xs text-emerald-700 mb-3">{message}</p>}
      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {[
          ["Loan amount", inr(loan.principalCents), `${Number(loan.interestRate)}% p.a. · ${loan.tenureMonths} months`],
          ["Monthly EMI", inr(loan.emiCents), `due on the 1st, first ${shortDate(loan.firstDueDate)}`],
          ["Collected", inr(collected), `${paid.length} of ${loan.tenureMonths} EMIs`],
          ["Left to collect", inr(loan.totalPayableCents - collected), `incl. ${inr(pending.reduce((s, e) => s + e.interestCents, 0))} interest`],
        ].map(([label, value, sub]) => (
          <div key={label} className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
            <div className="text-lg font-semibold text-slate-900 mt-1">{value}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>
          </div>
        ))}
      </div>

      <div className="text-xs text-slate-500 mb-2 flex flex-wrap gap-x-4 gap-y-1">
        <span>Disbursed {shortDate(loan.startDate)}</span>
        <span>Total interest {inr(loan.totalInterestCents)}</span>
        <span>Total payable {inr(loan.totalPayableCents)}</span>
        {loan.lastEmailAt && <span>Last emailed {new Date(loan.lastEmailAt).toLocaleString()}</span>}
        {loan.notes && <span>Note: {loan.notes}</span>}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="text-left font-semibold px-4 py-2">#</th>
              <th className="text-left font-semibold px-4 py-2">Due</th>
              <th className="text-right font-semibold px-4 py-2">EMI</th>
              <th className="text-right font-semibold px-4 py-2 hidden sm:table-cell">Principal</th>
              <th className="text-right font-semibold px-4 py-2 hidden sm:table-cell">Interest</th>
              <th className="text-right font-semibold px-4 py-2 hidden md:table-cell">Balance after</th>
              <th className="text-left font-semibold px-4 py-2">Status</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {emis.map((e) => {
              const overdue = e.status === "pending" && e.dueDate < today;
              return (
                <tr key={e.id} className={overdue ? "bg-red-50/40" : ""}>
                  <td className="px-4 py-2.5 text-slate-500">{e.installmentNo}</td>
                  <td className="px-4 py-2.5 text-slate-900">{shortDate(e.dueDate)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-slate-900">{inr(e.emiCents)}</td>
                  <td className="px-4 py-2.5 text-right text-slate-600 hidden sm:table-cell">{inr(e.principalCents)}</td>
                  <td className="px-4 py-2.5 text-right text-slate-600 hidden sm:table-cell">{inr(e.interestCents)}</td>
                  <td className="px-4 py-2.5 text-right text-slate-600 hidden md:table-cell">{inr(e.balanceAfterCents)}</td>
                  <td className="px-4 py-2.5">
                    {e.status === "paid" ? (
                      <span className="text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 text-emerald-700 bg-emerald-50" title={e.paidNote || ""}>Paid {shortDate(e.paidOn)}</span>
                    ) : overdue ? (
                      <span className="text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 text-red-700 bg-red-50">Overdue</span>
                    ) : (
                      <span className="text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 text-slate-600 bg-slate-100">{nextPending?.id === e.id ? "Next" : "Upcoming"}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {loan.status !== "cancelled" && e.status === "pending" && (
                      <button onClick={() => setPaying(e)} disabled={busy} className="text-[11px] font-medium text-white bg-slate-900 hover:bg-slate-700 rounded px-2 py-1 disabled:opacity-50">Mark paid</button>
                    )}
                    {e.status === "paid" && (
                      <button onClick={() => { if (confirm(`Undo the paid mark on EMI ${e.installmentNo}?`)) act(`/api/lending/loans/${loan.id}/emis/${e.id}`, "DELETE", undefined, "Paid mark removed."); }} disabled={busy} className="text-[11px] font-medium text-slate-500 hover:text-slate-800 px-2 py-1 disabled:opacity-50">Undo</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {paying && (
        <PayModal
          emi={paying}
          tenure={loan.tenureMonths}
          onClose={() => setPaying(null)}
          onSave={async (paidOn, note, sendEmail) => {
            const r = await act(`/api/lending/loans/${loan.id}/emis/${paying.id}`, "POST", { paidOn, note, sendEmail }, "");
            if (r) {
              setPaying(null);
              const email = (r as { email?: { ok: boolean; reason?: string } | null }).email;
              setMessage(email === null || email === undefined ? "EMI marked paid." : email.ok ? "EMI marked paid and receipt emailed to the borrower." : `EMI marked paid. Receipt email failed: ${email.reason || "unknown reason"}.`);
            }
          }}
        />
      )}
    </div>
  );
}

function PayModal({ emi, tenure, onClose, onSave }: { emi: Emi; tenure: number; onClose: () => void; onSave: (paidOn: string, note: string, sendEmail: boolean) => Promise<void> }) {
  const [paidOn, setPaidOn] = useState(todayIso());
  const [note, setNote] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [saving, setSaving] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <form onSubmit={async (e) => { e.preventDefault(); setSaving(true); await onSave(paidOn, note, sendEmail); setSaving(false); }} className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900 mb-1">Mark EMI {emi.installmentNo} of {tenure} as paid</h2>
        <p className="text-xs text-slate-500 mb-4">{inr(emi.emiCents)} due {shortDate(emi.dueDate)}.</p>
        <div className="space-y-3">
          <div>
            <label className={labelCls}>Paid on</label>
            <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Note (optional)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="UPI / cash / bank transfer…" className={inputCls} />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} /> Email a receipt to the borrower
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={saving} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">{saving ? "Saving…" : "Mark paid"}</button>
        </div>
      </form>
    </div>
  );
}

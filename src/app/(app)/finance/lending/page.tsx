"use client";

// Finance → Lending Bank (admin only). A private pool of money the admin
// lends to family and friends: balance on top, loans below, funds history
// at the bottom. INR only; not part of company finance.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/finance/shared";
import { inr, inputCls, labelCls, LoanStatusBadge, shortDate, todayIso } from "@/components/finance/lending-shared";

type Summary = { defaultInterestRate: number; hasFunds: boolean; balanceCents: number; depositsCents: number; withdrawalsCents: number; disbursedCents: number; repaidCents: number; outstandingPrincipalCents: number; interestEarnedCents: number; activeLoans: number };
type Loan = { id: string; loanNumber: number; borrowerName: string; borrowerPhone: string; borrowerEmail: string; principalCents: number; interestRate: string; tenureMonths: number; emiCents: number; totalPayableCents: number; startDate: string; firstDueDate: string; status: string; paidCount: number; paidCents: number; nextDue: string | null; overdue: number };
type Txn = { id: string; kind: string; amountCents: number; note: string | null; occurredOn: string; loanNumber: number | null; borrowerName: string | null };
type Preview = { emiCents: number; totalInterestCents: number; totalPayableCents: number; rows: { installmentNo: number; dueDate: string; emiCents: number; principalCents: number; interestCents: number; balanceAfterCents: number }[] };

const KIND_LABEL: Record<string, string> = { deposit: "Funds added", withdrawal: "Funds withdrawn", disbursement: "Loan given", repayment: "EMI received" };

export default function LendingPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [loadError, setLoadError] = useState("");
  const [showFunds, setShowFunds] = useState<"deposit" | "withdrawal" | null>(null);
  const [showLoan, setShowLoan] = useState(false);
  const [filter, setFilter] = useState<"active" | "all">("active");

  const load = useCallback(async () => {
    const res = await fetch("/api/finance/lending");
    if (!res.ok) { setLoadError((await res.json().catch(() => ({}))).error || "Could not load the Lending Bank."); return; }
    const data = await res.json();
    setSummary(data.summary);
    setLoans(data.loans || []);
    setTxns(data.transactions || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loadError) return <div className="p-6"><p className="text-sm text-red-600">{loadError}</p></div>;
  if (!summary) return <div className="p-6 text-sm text-slate-400">Loading…</div>;

  const visibleLoans = filter === "active" ? loans.filter((l) => l.status === "active") : loans;

  return (
    <div className="p-6 max-w-5xl">
      <PageHeader
        title="Lending Bank"
        subtitle="Your private lending pool. Loans repay in monthly EMIs with reducing-balance interest, due on the 1st. Separate from company finance."
        action={
          <div className="flex items-center gap-2">
            <button onClick={() => setShowFunds("deposit")} className="text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 px-3 py-2 rounded-md">{summary.hasFunds ? "Add funds" : "Set initial balance"}</button>
            <button onClick={() => setShowLoan(true)} disabled={!summary.hasFunds} title={summary.hasFunds ? "" : "Set the initial balance first"} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-40">New loan</button>
          </div>
        }
      />

      {!summary.hasFunds && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 mb-5">
          Start by setting the bank&apos;s initial balance — the money you have set aside for lending. Loans are given out of this balance and EMIs come back into it.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Card label="Available balance" value={inr(summary.balanceCents)} tone="emerald" />
        <Card label="Lent out (outstanding)" value={inr(summary.outstandingPrincipalCents)} sub={`${summary.activeLoans} active loan${summary.activeLoans === 1 ? "" : "s"}`} />
        <Card label="Interest earned" value={inr(summary.interestEarnedCents)} sub="from EMIs marked paid" />
        <Card label="Total funds added" value={inr(summary.depositsCents - summary.withdrawalsCents)} sub={`${inr(summary.repaidCents)} repaid so far`} />
      </div>

      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-slate-800">Loans</h2>
        <div className="flex items-center gap-2 text-xs">
          <button onClick={() => setFilter("active")} className={`px-2 py-1 rounded ${filter === "active" ? "bg-slate-900 text-white" : "text-slate-600 bg-slate-100"}`}>Active</button>
          <button onClick={() => setFilter("all")} className={`px-2 py-1 rounded ${filter === "all" ? "bg-slate-900 text-white" : "text-slate-600 bg-slate-100"}`}>All</button>
        </div>
      </div>
      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100 mb-6">
        {visibleLoans.map((l) => (
          <Link key={l.id} href={`/finance/lending/${l.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
            <span className="text-xs font-mono text-slate-400 w-12 shrink-0">LN-{l.loanNumber}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-900 truncate">{l.borrowerName} <span className="text-xs font-normal text-slate-400">· {l.borrowerPhone}</span></div>
              <div className="text-xs text-slate-400">
                {inr(l.principalCents)} at {Number(l.interestRate)}% · {l.tenureMonths} mo · EMI <strong className="text-slate-700">{inr(l.emiCents)}</strong> · {l.paidCount}/{l.tenureMonths} paid
                {l.status === "active" && l.nextDue ? ` · next due ${shortDate(l.nextDue)}` : ""}
              </div>
            </div>
            <LoanStatusBadge status={l.status} overdue={l.overdue} />
            <span className="text-sm font-semibold text-slate-900 w-28 text-right">{inr(l.totalPayableCents - l.paidCents)}<div className="text-[10px] font-normal text-slate-400">left to collect</div></span>
          </Link>
        ))}
        {visibleLoans.length === 0 && <p className="text-sm text-slate-400 px-4 py-8 text-center">{filter === "active" ? "No active loans." : "No loans yet."}</p>}
      </div>

      <h2 className="text-sm font-semibold text-slate-800 mb-2">Funds history</h2>
      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {txns.map((t) => (
          <div key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span className="text-xs text-slate-400 w-24 shrink-0">{shortDate(t.occurredOn)}</span>
            <div className="flex-1 min-w-0 text-slate-700 truncate">
              {KIND_LABEL[t.kind] ?? t.kind}{t.loanNumber ? ` · LN-${t.loanNumber} ${t.borrowerName ?? ""}` : ""}{t.note && t.kind !== "disbursement" && t.kind !== "repayment" ? ` · ${t.note}` : ""}
            </div>
            <span className={`font-semibold ${t.kind === "deposit" || t.kind === "repayment" ? "text-emerald-700" : "text-slate-900"}`}>{t.kind === "deposit" || t.kind === "repayment" ? "+" : "−"}{inr(t.amountCents)}</span>
          </div>
        ))}
        {txns.length === 0 && <p className="text-sm text-slate-400 px-4 py-6 text-center">No funds movements yet.</p>}
      </div>
      {summary.hasFunds && (
        <button onClick={() => setShowFunds("withdrawal")} className="mt-2 text-xs text-slate-500 hover:underline">Withdraw funds from the bank</button>
      )}

      {showFunds && <FundsModal kind={showFunds} initial={!summary.hasFunds} onClose={() => setShowFunds(null)} onSaved={() => { setShowFunds(null); load(); }} />}
      {showLoan && <LoanModal defaultRate={summary.defaultInterestRate} balanceCents={summary.balanceCents} onClose={() => setShowLoan(false)} onSaved={() => { setShowLoan(false); load(); }} />}
    </div>
  );
}

function Card({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "emerald" }) {
  return (
    <div className={`border rounded-lg p-4 ${tone === "emerald" ? "bg-emerald-50 border-emerald-200" : "bg-white border-slate-200"}`}>
      <div className={`text-[11px] font-semibold uppercase tracking-wide ${tone === "emerald" ? "text-emerald-700" : "text-slate-400"}`}>{label}</div>
      <div className={`text-xl font-semibold mt-1 ${tone === "emerald" ? "text-emerald-800" : "text-slate-900"}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function FundsModal({ kind, initial, onClose, onSaved }: { kind: "deposit" | "withdrawal"; initial: boolean; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const res = await fetch("/api/finance/lending/funds", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount, date, note, kind }) });
    setSaving(false);
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || "Could not save"); return; }
    onSaved();
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <form onSubmit={save} className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900 mb-1">{kind === "withdrawal" ? "Withdraw funds" : initial ? "Set initial balance" : "Add funds"}</h2>
        <p className="text-xs text-slate-500 mb-4">{kind === "withdrawal" ? "Take money out of the lending pool." : "Money you are setting aside in your own bank account for lending. You can add more any time."}</p>
        <div className="space-y-3">
          <div>
            <label className={labelCls}>Amount (₹)</label>
            <input autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="50000" required className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Note (optional)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className={inputCls} />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={saving} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">{saving ? "Saving…" : kind === "withdrawal" ? "Withdraw" : "Add"}</button>
        </div>
      </form>
    </div>
  );
}

function LoanModal({ defaultRate, balanceCents, onClose, onSaved }: { defaultRate: number; balanceCents: number; onClose: () => void; onSaved: () => void }) {
  const [borrowerName, setBorrowerName] = useState("");
  const [borrowerPhone, setBorrowerPhone] = useState("");
  const [borrowerEmail, setBorrowerEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState(String(defaultRate));
  const [months, setMonths] = useState("12");
  const [startDate, setStartDate] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ id: string; loanNumber: number; emailOk: boolean | null; emailReason?: string } | null>(null);

  useEffect(() => {
    const amt = Number(amount);
    if (!(amt > 0) || !(Number(rate) >= 0)) { setPreview(null); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/finance/lending/loans?amount=${encodeURIComponent(amount)}&rate=${encodeURIComponent(rate)}&months=${months}&start=${startDate}`, { signal: ctrl.signal })
        .then(async (r) => { if (r.ok) setPreview(await r.json()); })
        .catch(() => {});
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [amount, rate, months, startDate]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const res = await fetch("/api/finance/lending/loans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ borrowerName, borrowerPhone, borrowerEmail, amount, interestRate: rate, tenureMonths: Number(months), startDate, notes, sendEmail }),
    });
    setSaving(false);
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || "Could not create the loan"); return; }
    const data = await res.json();
    setDone({ id: data.loan.id, loanNumber: data.loan.loanNumber, emailOk: data.email ? data.email.ok : null, emailReason: data.email?.reason });
  }

  if (done) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onSaved}>
        <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5 text-center" onClick={(e) => e.stopPropagation()}>
          <div className="mx-auto w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center text-xl mb-3">✓</div>
          <h2 className="text-base font-semibold text-slate-900">Loan LN-{done.loanNumber} given</h2>
          <p className="text-sm text-slate-500 mt-1">
            {done.emailOk === true ? "Loan details and the EMI schedule were emailed to the borrower." : done.emailOk === false ? `Loan saved, but the email could not be sent: ${done.emailReason || "unknown reason"}. You can resend it from the loan page.` : "Loan saved. No email was sent."}
          </p>
          <div className="flex justify-center gap-2 mt-5">
            <Link href={`/finance/lending/${done.id}`} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">Open loan</Link>
            <button onClick={onSaved} className="text-sm font-medium text-slate-600 bg-slate-100 px-4 py-2 rounded-md">Done</button>
          </div>
        </div>
      </div>
    );
  }

  const overBalance = preview ? Number(amount) * 100 > balanceCents : false;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <form onSubmit={save} className="bg-white rounded-lg shadow-xl w-full max-w-2xl p-5 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900 mb-1">New loan</h2>
        <p className="text-xs text-slate-500 mb-4">Available balance: <strong className="text-slate-900">{inr(balanceCents)}</strong>. The borrower gets an email with the full EMI schedule.</p>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-5">
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className={labelCls}>Borrower name <span className="text-red-500">*</span></label>
                <input value={borrowerName} onChange={(e) => setBorrowerName(e.target.value)} required maxLength={160} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Phone <span className="text-red-500">*</span></label>
                <input value={borrowerPhone} onChange={(e) => setBorrowerPhone(e.target.value)} required maxLength={40} placeholder="+91 …" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Email <span className="text-red-500">*</span></label>
                <input type="email" value={borrowerEmail} onChange={(e) => setBorrowerEmail(e.target.value)} required maxLength={200} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Loan amount (₹) <span className="text-red-500">*</span></label>
                <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" required placeholder="100000" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Interest rate (% per year)</label>
                <input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Tenure</label>
                <select value={months} onChange={(e) => setMonths(e.target.value)} className={`${inputCls} bg-white`}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m} month{m === 1 ? "" : "s"}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Disbursed on</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Notes (internal)</label>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} className={inputCls} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} /> Email the loan details and EMI schedule to the borrower now
            </label>
          </div>
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 text-sm">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-2">EMI preview</div>
            {preview ? (
              <>
                <div className="text-2xl font-semibold text-slate-900">{inr(preview.emiCents)}<span className="text-xs font-normal text-slate-400"> / month</span></div>
                <dl className="mt-3 space-y-1 text-xs text-slate-600">
                  <div className="flex justify-between"><dt>Total interest</dt><dd className="font-semibold text-slate-900">{inr(preview.totalInterestCents)}</dd></div>
                  <div className="flex justify-between"><dt>Total payable</dt><dd className="font-semibold text-slate-900">{inr(preview.totalPayableCents)}</dd></div>
                  <div className="flex justify-between"><dt>First EMI due</dt><dd className="font-semibold text-slate-900">{shortDate(preview.rows[0]?.dueDate)}</dd></div>
                  <div className="flex justify-between"><dt>Last EMI due</dt><dd className="font-semibold text-slate-900">{shortDate(preview.rows[preview.rows.length - 1]?.dueDate)}</dd></div>
                </dl>
                {overBalance && <p className="text-xs text-red-600 mt-3">More than the available balance.</p>}
              </>
            ) : (
              <p className="text-xs text-slate-400">Enter an amount to see the EMI.</p>
            )}
          </div>
        </div>
        {error && <p className="text-xs text-red-600 mt-3">{error}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={saving || !preview || overBalance} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">{saving ? "Saving…" : "Give loan"}</button>
        </div>
      </form>
    </div>
  );
}

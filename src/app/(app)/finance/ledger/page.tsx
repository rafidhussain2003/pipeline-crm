"use client";

import { useEffect, useState } from "react";
import { AccountSelect, money, moneyNum, PageHeader, useAccounts, useFinanceCurrency } from "@/components/finance/shared";

type LedgerData = {
  account: { code: string; name: string; type: string };
  openingCents: number;
  closingCents: number;
  entries: { id: string; entryDate: string; entryNumber: number | null; memo: string | null; sourceType: string; debit: string; credit: string; description: string | null; runningBalanceCents: number; journalStatus: string }[];
  total: number;
  offset: number;
  hasMore: boolean;
};
const PAGE = 200;

export default function GeneralLedgerPage() {
  useFinanceCurrency();
  const { accounts } = useAccounts();
  const [accountId, setAccountId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<LedgerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchPage = async (offset: number) => {
    const p = new URLSearchParams({ accountId, limit: String(PAGE), offset: String(offset) });
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    const r = await fetch(`/api/finance/ledger?${p}`);
    return r.ok ? ((await r.json()) as LedgerData) : null;
  };

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    setLoading(true);
    fetchPage(0).then((d) => {
      if (cancelled) return;
      setData(d);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [accountId, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  // Next page appended; its running balances are computed server-side over the
  // whole window, so they continue exactly from the rows already shown.
  async function loadMore() {
    if (!data || !data.hasMore) return;
    setLoadingMore(true);
    const next = await fetchPage(data.offset + PAGE);
    if (next) setData({ ...next, entries: [...data.entries, ...next.entries] });
    setLoadingMore(false);
  }

  return (
    <div className="p-6 max-w-4xl">
      <PageHeader title="General Ledger" subtitle="The immutable account-by-account history. Every posted line, nothing edited, corrections only by reversal." />

      <div className="flex flex-wrap gap-2 mb-4">
        <div className="min-w-[260px] flex-1">
          <AccountSelect accounts={accounts} value={accountId} onChange={setAccountId} placeholder="Choose an account…" />
        </div>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-md border border-slate-200 px-3 py-2 text-sm" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-md border border-slate-200 px-3 py-2 text-sm" />
      </div>

      {!accountId && <p className="text-sm text-slate-400">Pick an account to see its ledger.</p>}
      {loading && <p className="text-sm text-slate-400">Loading…</p>}

      {data && !loading && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-800">{data.account.code} — {data.account.name}</div>
            <div className="text-xs text-slate-500">Opening {money(data.openingCents)} · Closing {money(data.closingCents)}</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                  <th className="text-left font-medium px-4 py-2">Date</th>
                  <th className="text-left font-medium px-2 py-2">Entry</th>
                  <th className="text-left font-medium px-2 py-2">Memo</th>
                  <th className="text-right font-medium px-2 py-2">Debit</th>
                  <th className="text-right font-medium px-2 py-2">Credit</th>
                  <th className="text-right font-medium px-4 py-2">Balance</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e) => (
                  <tr key={e.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-2 text-slate-600 whitespace-nowrap">{e.entryDate}</td>
                    <td className="px-2 py-2 font-mono text-xs text-slate-400">JE-{e.entryNumber}</td>
                    <td className="px-2 py-2 text-slate-700 max-w-[220px] truncate">{e.description || e.memo || e.sourceType}</td>
                    <td className="px-2 py-2 text-right text-slate-900">{Number(e.debit) > 0 ? moneyNum(e.debit) : ""}</td>
                    <td className="px-2 py-2 text-right text-slate-900">{Number(e.credit) > 0 ? moneyNum(e.credit) : ""}</td>
                    <td className="px-4 py-2 text-right font-medium text-slate-900">{money(e.runningBalanceCents)}</td>
                  </tr>
                ))}
                {data.entries.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No ledger activity for this account{from || to ? " in this range" : ""}.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>Showing {data.entries.length} of {data.total} entries</span>
            {data.hasMore && (
              <button onClick={loadMore} disabled={loadingMore} className="font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded px-2 py-1 disabled:opacity-50">
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

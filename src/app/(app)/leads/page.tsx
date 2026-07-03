"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";

type Lead = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  disposition: string;
  ownerName: string | null;
  followUpAt: string | null;
  createdAt: string;
  isDuplicate: boolean;
};

type Disposition = { id: string; label: string; color: string };

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [dispositions, setDispositions] = useState<Disposition[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    const [leadsRes, dispRes] = await Promise.all([
      fetch(`/api/leads?${params.toString()}`),
      fetch("/api/dispositions"),
    ]);
    const leadsData = await leadsRes.json();
    const dispData = await dispRes.json();
    setLeads(leadsData.leads || []);
    setDispositions(dispData.dispositions || []);
    setLoading(false);
  }, [search]);

  useEffect(() => {
    const timeout = setTimeout(load, 250);
    return () => clearTimeout(timeout);
  }, [load]);

  async function updateDisposition(leadId: string, disposition: string) {
    setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, disposition } : l)));
    await fetch(`/api/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disposition }),
    });
  }

  function colorFor(label: string) {
    return dispositions.find((d) => d.label === label)?.color || "#64748b";
  }

  function exportCsv() {
    window.location.href = "/api/leads/export";
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult("");
    const text = await file.text();
    const res = await fetch("/api/leads/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv: text }),
    });
    const data = await res.json();
    setImporting(false);
    if (res.ok) {
      setImportResult(`Imported ${data.created} leads (${data.duplicates} flagged as possible duplicates, ${data.skipped} skipped).`);
      load();
    } else {
      setImportResult(data.error || "Import failed.");
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Leads CRM <span className="text-blue-600">{leads.length} loaded</span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-md px-3 py-2 disabled:opacity-40"
          >
            {importing ? "Importing…" : "Import CSV"}
          </button>
          <input ref={fileInputRef} type="file" accept=".csv" onChange={handleImportFile} className="hidden" />
          <button onClick={exportCsv} className="text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-md px-3 py-2">
            Export CSV
          </button>
        </div>
      </div>

      {importResult && (
        <div className="mb-4 text-sm bg-blue-50 border border-blue-100 text-blue-800 rounded-md px-3 py-2">{importResult}</div>
      )}

      <div className="flex items-center gap-3 mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, phone, email"
          className="w-full max-w-md rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Owner</th>
              <th className="px-4 py-3">Disposition</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  Loading leads…
                </td>
              </tr>
            )}
            {!loading && leads.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  No leads yet. Connect a Facebook page under Connect Facebook to start receiving leads.
                </td>
              </tr>
            )}
            {leads.map((lead) => (
              <tr key={lead.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link href={`/leads/${lead.id}`} className="font-medium text-blue-700 hover:underline">
                    {lead.name || "—"}
                  </Link>
                  {lead.isDuplicate && (
                    <span className="ml-2 text-[10px] font-semibold text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">
                      POSSIBLE DUPLICATE
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-700">{lead.phone || "—"}</td>
                <td className="px-4 py-3 text-slate-500">{lead.email || "—"}</td>
                <td className="px-4 py-3 text-slate-700">{lead.ownerName || <span className="text-slate-400">Unassigned</span>}</td>
                <td className="px-4 py-3">
                  <select
                    value={lead.disposition}
                    onChange={(e) => updateDisposition(lead.id, e.target.value)}
                    style={{ backgroundColor: `${colorFor(lead.disposition)}1a`, color: colorFor(lead.disposition) }}
                    className="text-xs font-medium rounded-full px-3 py-1 border-0 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {dispositions.map((d) => (
                      <option key={d.id} value={d.label}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3 text-slate-400">{new Date(lead.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

"use client";

// Finance → Clients: the companies we bill. Created once with every detail an
// invoice prints (legal name, address, country …), then picked when recording
// revenue so each invoice carries identical "Bill To" details.
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/finance/shared";
import { ClientModal, clientAddress, type Client } from "@/components/finance/ClientModal";

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Client | "new" | null>(null);
  const [error, setError] = useState("");

  const load = async () => {
    const res = await fetch(`/api/finance/clients${showArchived ? "?all=1" : ""}`);
    if (res.ok) setClients((await res.json()).clients || []);
  };
  useEffect(() => { load(); }, [showArchived]); // eslint-disable-line react-hooks/exhaustive-deps

  async function setActive(c: Client, active: boolean) {
    setError("");
    const res = await fetch(`/api/finance/clients/${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active }) });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || "Could not update");
    load();
  }

  return (
    <div className="p-6 max-w-4xl">
      <PageHeader
        title="Clients"
        subtitle="The companies you bill. Create a client once with its full address; every invoice you post for it is printed from these details."
        action={<button onClick={() => setEditing("new")} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">Add client</button>}
      />
      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}
      <label className="flex items-center gap-2 text-xs text-slate-500 mb-3">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived clients
      </label>

      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {clients.map((c) => (
          <div key={c.id} className={`flex items-start gap-3 px-4 py-3 ${c.active ? "" : "opacity-50"}`}>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                {c.name}
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">{c.invoiceCurrency}</span>
                {!c.active && <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">Archived</span>}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">{clientAddress(c)}</div>
              <div className="text-xs text-slate-400 mt-0.5">
                {c.serviceDescription}{c.gstin ? ` · GSTIN ${c.gstin}` : ""}{c.email ? ` · ${c.email}` : ""}
              </div>
            </div>
            <button onClick={() => setEditing(c)} className="text-[11px] font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded px-2 py-1">Edit</button>
            {c.active ? (
              <button onClick={() => setActive(c, false)} className="text-[11px] font-medium text-red-600 bg-red-50 rounded px-2 py-1">Archive</button>
            ) : (
              <button onClick={() => setActive(c, true)} className="text-[11px] font-medium text-emerald-700 bg-emerald-50 rounded px-2 py-1">Restore</button>
            )}
          </div>
        ))}
        {clients.length === 0 && (
          <p className="text-sm text-slate-400 px-4 py-8 text-center">No clients yet. Add the first company you invoice.</p>
        )}
      </div>

      {editing && (
        <ClientModal
          client={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

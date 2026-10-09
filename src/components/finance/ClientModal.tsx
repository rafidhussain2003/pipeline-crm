"use client";

// Billing client shape + the create/edit modal, shared by Finance → Clients and
// the "+ New client" shortcut inside Record Revenue.
import { useState } from "react";

export type Client = {
  id: string; name: string; addressLine1: string; addressLine2: string | null; city: string; state: string | null;
  postalCode: string | null; country: string; email: string | null; phone: string | null; gstin: string | null;
  invoiceCurrency: string; serviceDescription: string; notes: string | null; active: boolean;
};

export function clientAddress(c: Client): string {
  const locality = [c.city, c.state, c.country].filter(Boolean).join(", ") + (c.postalCode ? ` ${c.postalCode}` : "");
  return [c.addressLine1, c.addressLine2, locality].filter(Boolean).join(", ");
}

const EMPTY = { name: "", addressLine1: "", addressLine2: "", city: "", state: "", postalCode: "", country: "", email: "", phone: "", gstin: "", invoiceCurrency: "USD", serviceDescription: "BPO Services", notes: "" };

export function ClientModal({ client, onClose, onSaved }: { client: Client | null; onClose: () => void; onSaved: (c: Client) => void }) {
  const [form, setForm] = useState({
    ...EMPTY,
    ...(client
      ? {
          name: client.name, addressLine1: client.addressLine1, addressLine2: client.addressLine2 ?? "", city: client.city, state: client.state ?? "",
          postalCode: client.postalCode ?? "", country: client.country, email: client.email ?? "", phone: client.phone ?? "", gstin: client.gstin ?? "",
          invoiceCurrency: client.invoiceCurrency, serviceDescription: client.serviceDescription, notes: client.notes ?? "",
        }
      : {}),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const res = await fetch(client ? `/api/finance/clients/${client.id}` : "/api/finance/clients", {
      method: client ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Could not save");
      return;
    }
    onSaved((await res.json()).client);
  }

  const field = (label: string, k: keyof typeof EMPTY, opts: { required?: boolean; placeholder?: string; span?: boolean; maxLength?: number } = {}) => (
    <div className={opts.span ? "sm:col-span-2" : ""}>
      <label className="block text-xs font-semibold text-slate-600 mb-1">{label}{opts.required && <span className="text-red-500"> *</span>}</label>
      <input value={form[k]} onChange={set(k)} required={opts.required} placeholder={opts.placeholder} maxLength={opts.maxLength} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <form onSubmit={save} className="bg-white rounded-lg shadow-xl w-full max-w-lg p-5 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900 mb-1">{client ? "Edit client" : "Add client"}</h2>
        <p className="text-xs text-slate-500 mb-4">These details print in the invoice&apos;s &quot;Bill To&quot; box exactly as entered.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {field("Company name", "name", { required: true, placeholder: "Hackfeld Enterprises", span: true })}
          {field("Address line 1", "addressLine1", { required: true, placeholder: "2024 W 15th St", span: true })}
          {field("Address line 2", "addressLine2", { placeholder: "Suite / floor (optional)", span: true })}
          {field("City", "city", { required: true, placeholder: "Plano" })}
          {field("State / Province", "state", { placeholder: "Texas" })}
          {field("Postal / ZIP code", "postalCode", { placeholder: "75075" })}
          {field("Country", "country", { required: true, placeholder: "USA" })}
          {field("Email", "email", { placeholder: "billing@client.com" })}
          {field("Phone", "phone", { placeholder: "+1 …" })}
          {field("Client GSTIN", "gstin", { placeholder: "Only for Indian clients", maxLength: 32 })}
          {field("Invoice currency", "invoiceCurrency", { required: true, placeholder: "USD", maxLength: 3 })}
          {field("Service description", "serviceDescription", { required: true, placeholder: "BPO Services", span: true })}
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-slate-600 mb-1">Notes (internal, never printed)</label>
            <textarea value={form.notes} onChange={set("notes")} rows={2} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </div>
        </div>
        <p className="text-[11px] text-slate-400 mt-2">
          The invoice line reads &quot;{form.serviceDescription || "BPO Services"} for &lt;service period&gt;&quot;, e.g. &quot;{form.serviceDescription || "BPO Services"} for July 2026&quot;.
        </p>
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={saving} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">
            {saving ? "Saving…" : client ? "Save changes" : "Create client"}
          </button>
        </div>
      </form>
    </div>
  );
}

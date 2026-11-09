"use client";

// E-Sign (admin only): documents sent for signature. Upload a PDF to start.
import { useEffect, useState } from "react";
import Link from "next/link";
import { STATUS_STYLE, fmtWhen } from "@/components/esign/shared";

type Doc = { id: string; title: string; status: string; pageCount: number; createdAt: string; sentAt: string | null; completedAt: string | null; signers: { name: string; email: string; status: string }[]; linkActive: boolean; copies: number; parentDocumentId: string | null; parentTitle: string | null };

export default function EsignPage() {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [error, setError] = useState("");
  const [showUpload, setShowUpload] = useState(false);

  const load = async () => {
    const res = await fetch("/api/esign");
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || "Could not load"); return; }
    setDocs((await res.json()).documents || []);
  };
  useEffect(() => { load(); }, []);

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Docusign</h1>
          <p className="text-sm text-slate-500 mt-1">Upload a PDF, place signature fields, then email it to named signers or generate a 24-hour share link anyone can open and sign — no account needed.</p>
        </div>
        <button onClick={() => setShowUpload(true)} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">Upload document</button>
      </div>
      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}
      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {docs?.map((d) => (
          <Link key={d.id} href={`/esign/${d.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-900 truncate">{d.title}</div>
              <div className="text-xs text-slate-400 truncate">
                {d.pageCount} page{d.pageCount === 1 ? "" : "s"} · {d.signers.length === 0 ? "no signers yet" : d.signers.map((s) => `${s.name}${s.status === "signed" ? " ✓" : s.status === "declined" ? " ✕" : ""}`).join(", ")}
                {d.status === "completed" ? ` · completed ${fmtWhen(d.completedAt)}` : d.sentAt ? ` · sent ${fmtWhen(d.sentAt)}` : ` · created ${fmtWhen(d.createdAt)}`}
              </div>
            </div>
            {d.parentDocumentId && <span className="text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 text-violet-700 bg-violet-50" title={d.parentTitle ? `Copy of ${d.parentTitle}` : undefined}>via link</span>}
            {d.copies > 0 && <span className="text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 text-violet-700 bg-violet-50">{d.copies} via link</span>}
            {d.linkActive && <span className="text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 text-sky-700 bg-sky-50">Link active</span>}
            <span className={`text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${STATUS_STYLE[d.status] || ""}`}>{d.status}</span>
          </Link>
        ))}
        {docs && docs.length === 0 && <p className="text-sm text-slate-400 px-4 py-10 text-center">No documents yet. Upload a PDF to send for signature.</p>}
        {!docs && !error && <p className="text-sm text-slate-400 px-4 py-10 text-center">Loading…</p>}
      </div>
      {showUpload && <UploadModal onClose={() => setShowUpload(false)} />}
    </div>
  );
}

function UploadModal({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setSaving(true); setError("");
    const fd = new FormData(); fd.append("file", file); fd.append("title", title);
    const res = await fetch("/api/esign", { method: "POST", body: fd });
    setSaving(false);
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || "Upload failed"); return; }
    const { document } = await res.json();
    window.location.href = `/esign/${document.id}`;
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <form onSubmit={save} className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900 mb-3">Upload a PDF</h2>
        <label className="block text-xs font-semibold text-slate-600 mb-1">File</label>
        <input type="file" accept="application/pdf,.pdf" required onChange={(e) => { const f = e.target.files?.[0] || null; setFile(f); if (f && !title) setTitle(f.name.replace(/\.pdf$/i, "")); }} className="w-full text-sm mb-3" />
        <label className="block text-xs font-semibold text-slate-600 mb-1">Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Service agreement" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={saving || !file} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">{saving ? "Uploading…" : "Continue"}</button>
        </div>
      </form>
    </div>
  );
}

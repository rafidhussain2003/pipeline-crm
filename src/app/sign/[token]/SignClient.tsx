"use client";

// The signer's experience: review the document, adopt a signature once, click
// each highlighted field to apply/fill it, Finish — or Decline. After everyone
// has signed, the same link shows the completed document for download.
import { useCallback, useEffect, useMemo, useState } from "react";
import { PdfPages, type PageGeom } from "@/components/esign/PdfPages";
import { SignaturePad } from "@/components/esign/SignaturePad";
import { FIELD_LABEL, type FieldType } from "@/components/esign/shared";

type Field = { id: string; signerId: string; type: FieldType; page: number; x: number; y: number; w: number; h: number; required: boolean; label: string | null; value: string | null; mine: boolean };
type View = {
  document: { id: string; title: string; pageCount: number; status: string; message: string | null; sender: string; completedAt: string | null };
  signer: { id: string; name: string; email: string; status: string; color: string; signedAt: string | null; declinedAt: string | null; signatureData: string | null; initialsData: string | null };
  signers: { id: string; name: string; status: string; color: string }[];
  fields: Field[];
  signatures: Record<string, { signature: string | null; initials: string | null }>;
};

export function SignClient({ token }: { token: string }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [initials, setInitials] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [pad, setPad] = useState<{ kind: "signature" | "initials"; fieldId: string } | null>(null);
  const [editingText, setEditingText] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [done, setDone] = useState<"signed" | "completed" | "declined" | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/sign/${token}`);
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || "This signing link is not valid."); return; }
    const v: View = await res.json();
    setView(v);
    setSignature(v.signer.signatureData);
    setInitials(v.signer.initialsData);
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const mine = useMemo(() => (view?.fields ?? []).filter((f) => f.mine), [view]);
  const isApplied = (f: Field) => (f.type === "signature" ? values[f.id] !== false && !!signature && values[f.id] === true : f.type === "initials" ? values[f.id] === true && !!initials : f.type === "checkbox" ? values[f.id] === true : typeof values[f.id] === "string" && !!values[f.id]);
  const missing = mine.filter((f) => f.required && !isApplied(f));
  const canSign = !!view && view.document.status === "sent" && (view.signer.status === "sent" || view.signer.status === "viewed" || view.signer.status === "pending");
  const todayLabel = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  function clickField(f: Field) {
    if (!canSign || !f.mine) return;
    if (f.type === "signature") { if (signature) setValues((v) => ({ ...v, [f.id]: !(v[f.id] === true) })); else setPad({ kind: "signature", fieldId: f.id }); }
    else if (f.type === "initials") { if (initials) setValues((v) => ({ ...v, [f.id]: !(v[f.id] === true) })); else setPad({ kind: "initials", fieldId: f.id }); }
    else if (f.type === "date") setValues((v) => ({ ...v, [f.id]: v[f.id] ? "" : todayLabel }));
    else if (f.type === "checkbox") setValues((v) => ({ ...v, [f.id]: !(v[f.id] === true) }));
    else setEditingText(f.id);
  }
  function applyAllOfType(kind: "signature" | "initials") {
    setValues((v) => { const next = { ...v }; for (const f of mine) if (f.type === kind) next[f.id] = true; return next; });
  }

  async function finish() {
    if (!view) return;
    setSubmitting(true); setError("");
    const payload: Record<string, string | boolean> = {};
    for (const f of mine) {
      if (f.type === "signature" || f.type === "initials") payload[f.id] = values[f.id] === true;
      else if (f.type === "date") payload[f.id] = typeof values[f.id] === "string" ? (values[f.id] as string) : "";
      else payload[f.id] = values[f.id] ?? "";
    }
    const res = await fetch(`/api/sign/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ signatureData: signature, initialsData: initials, values: payload }) });
    setSubmitting(false);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setError(d.error || "Could not submit your signature"); return; }
    setDone(d.completed ? "completed" : "signed");
    await load();
  }
  async function decline() {
    const reason = prompt("Decline to sign? You can give a reason for the sender (optional):");
    if (reason === null) return;
    setDeclining(true);
    const res = await fetch(`/api/sign/${token}/decline`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
    setDeclining(false);
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || "Could not decline"); return; }
    setDone("declined"); await load();
  }

  if (error && !view) return <Shell><div className="max-w-md mx-auto mt-24 text-center"><h1 className="text-lg font-semibold text-slate-900">Link not available</h1><p className="text-sm text-slate-500 mt-2">{error}</p></div></Shell>;
  if (!view) return <Shell><p className="text-sm text-slate-400 text-center mt-24">Loading…</p></Shell>;

  const status = view.document.status;
  const banner =
    status === "voided" ? { tone: "red", text: "This document was voided by the sender and can no longer be signed." }
    : status === "completed" ? { tone: "green", text: `Completed${view.document.completedAt ? ` on ${new Date(view.document.completedAt).toLocaleString()}` : ""}. Everyone has signed.` }
    : view.signer.status === "signed" ? { tone: "green", text: `You signed on ${new Date(view.signer.signedAt!).toLocaleString()}. Waiting for ${view.signers.filter((s) => s.status !== "signed").map((s) => s.name).join(", ") || "others"}.` }
    : view.signer.status === "declined" ? { tone: "red", text: "You declined to sign this document." }
    : null;

  return (
    <Shell>
      {/* Top bar */}
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-slate-900 truncate">{view.document.title}</div>
            <div className="text-xs text-slate-500 truncate">From {view.document.sender} · for {view.signer.name} ({view.signer.email})</div>
          </div>
          {canSign && !done && (
            <>
              <span className="text-xs text-slate-500">{missing.length === 0 ? "All fields complete" : `${missing.length} field${missing.length === 1 ? "" : "s"} left`}</span>
              <button onClick={decline} disabled={declining} className="text-xs font-medium text-slate-500 hover:text-red-600 px-2 py-2">Decline</button>
              <button onClick={finish} disabled={submitting || missing.length > 0} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-40">{submitting ? "Submitting…" : "Finish"}</button>
            </>
          )}
          {status === "completed" && <a href={`/api/sign/${token}/signed`} className="bg-emerald-600 text-white text-sm font-medium px-4 py-2 rounded-md">Download signed PDF</a>}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-4">
        {done === "signed" && <Note tone="green">Thank you — your signature has been recorded. You&apos;ll receive the completed document by email once everyone has signed.</Note>}
        {done === "completed" && <Note tone="green">Thank you — everyone has signed. The completed document has been emailed to all parties and can be downloaded above.</Note>}
        {done === "declined" && <Note tone="red">You declined to sign. The sender has been notified.</Note>}
        {!done && banner && <Note tone={banner.tone as "green" | "red"}>{banner.text}</Note>}
        {!done && canSign && (
          <Note tone="blue">
            {view.document.message ? <span className="block mb-1 italic">&ldquo;{view.document.message}&rdquo;</span> : null}
            Click each highlighted field to sign or fill it in, then press <strong>Finish</strong>.
            {mine.some((f) => f.type === "signature") && !signature && <> Start with a <strong>Signature</strong> field to adopt your signature.</>}
          </Note>
        )}
        {error && <Note tone="red">{error}</Note>}

        <PdfPages
          src={`/api/sign/${token}/file`}
          renderOverlay={(page) => view.fields.map((f) => f.page === page.index && (
            <SignerField key={f.id} f={f} page={page} view={view} applied={isApplied(f)} value={values[f.id]} signature={signature} initials={initials} canSign={canSign && !done} onClick={() => clickField(f)} />
          ))}
        />
      </div>

      {pad && (
        <SignaturePad
          kind={pad.kind}
          defaultText={pad.kind === "signature" ? view.signer.name : view.signer.name.split(/\s+/).map((p) => p[0] ?? "").join("").toUpperCase().slice(0, 4)}
          onClose={() => setPad(null)}
          onAdopt={(data) => { if (pad.kind === "signature") setSignature(data); else setInitials(data); applyAllOfType(pad.kind); setPad(null); }}
        />
      )}
      {editingText && (
        <TextPrompt field={mine.find((f) => f.id === editingText)!} initial={typeof values[editingText] === "string" ? (values[editingText] as string) : ""} onClose={() => setEditingText(null)} onSave={(v) => { setValues((x) => ({ ...x, [editingText]: v })); setEditingText(null); }} />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-slate-100 text-slate-900">{children}<p className="text-center text-[11px] text-slate-400 py-6">Secured by Ziplod Docusign · each action is time-stamped with your IP address</p></div>;
}
function Note({ tone, children }: { tone: "green" | "red" | "blue"; children: React.ReactNode }) {
  const cls = tone === "green" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : tone === "red" ? "bg-red-50 border-red-200 text-red-800" : "bg-blue-50 border-blue-200 text-blue-900";
  return <div className={`rounded-md border px-4 py-3 text-sm mb-4 ${cls}`}>{children}</div>;
}

function SignerField({ f, page, view, applied, value, signature, initials, canSign, onClick }: { f: Field; page: PageGeom; view: View; applied: boolean; value: string | boolean | undefined; signature: string | null; initials: string | null; canSign: boolean; onClick: () => void }) {
  const color = view.signers.find((s) => s.id === f.signerId)?.color || "#2563eb";
  const style = { left: f.x * page.width, top: f.y * page.height, width: f.w * page.width, height: f.h * page.height };
  // Someone else's (or my already-submitted) field: render its value.
  const submitted = !!f.value;
  if (!f.mine || submitted) {
    const sig = f.type === "signature" ? view.signatures[f.signerId]?.signature : f.type === "initials" ? view.signatures[f.signerId]?.initials : null;
    return (
      <div className="absolute flex items-end" style={style} title={`${FIELD_LABEL[f.type]} — ${view.signers.find((s) => s.id === f.signerId)?.name ?? ""}`}>
        {submitted && sig && <img src={sig} alt="" className="max-h-full max-w-full object-contain object-left-bottom" />}
        {submitted && f.type === "checkbox" && f.value === "true" && <span className="w-full h-full flex items-center justify-center font-bold text-[#0b1a6b]">✕</span>}
        {submitted && (f.type === "date" || f.type === "text") && <span className="text-[#0b1a6b] text-xs truncate">{f.value}</span>}
        {!submitted && <div className="absolute inset-0 rounded-sm border border-dashed opacity-60" style={{ borderColor: color }} />}
      </div>
    );
  }
  const img = f.type === "signature" ? signature : f.type === "initials" ? initials : null;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!canSign}
      className={`absolute pointer-events-auto rounded-sm border-2 text-left overflow-hidden transition ${applied ? "border-emerald-500 bg-white/70" : ""} ${canSign ? "cursor-pointer hover:shadow-md" : ""}`}
      style={{ ...style, borderColor: applied ? "#10b981" : color, background: applied ? "rgba(255,255,255,0.7)" : `${color}2e` }}
      title={applied ? "Click to change" : `Click to ${f.type === "signature" ? "sign" : f.type === "initials" ? "initial" : f.type === "date" ? "date" : f.type === "checkbox" ? "check" : "fill in"}`}
    >
      {applied && img && (f.type === "signature" || f.type === "initials") ? (
        <img src={img} alt="" className="absolute left-0.5 bottom-0.5 max-h-[95%] max-w-[95%] object-contain" />
      ) : applied && f.type === "checkbox" ? (
        <span className="w-full h-full flex items-center justify-center font-bold text-[#0b1a6b]">✕</span>
      ) : applied ? (
        <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[#0b1a6b] text-xs truncate max-w-[95%]">{String(value)}</span>
      ) : (
        <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[11px] font-semibold" style={{ color }}>{f.type === "signature" ? "Sign here" : f.type === "initials" ? "Initial" : f.type === "date" ? "Date" : f.type === "checkbox" ? "" : f.label || "Enter text"}</span>
      )}
    </button>
  );
}

function TextPrompt({ field, initial, onClose, onSave }: { field: Field; initial: string; onClose: () => void; onSave: (v: string) => void }) {
  const [v, setV] = useState(initial);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onSave(v.trim()); }} className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900 mb-3">{field.label || "Enter text"}</h2>
        <input autoFocus value={v} onChange={(e) => setV(e.target.value)} maxLength={500} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={onClose} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Cancel</button>
          <button type="submit" className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">Apply</button>
        </div>
      </form>
    </div>
  );
}

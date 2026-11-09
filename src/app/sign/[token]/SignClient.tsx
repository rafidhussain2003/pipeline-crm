"use client";

// The signer's experience: review the document, adopt a signature once, click
// each highlighted field to apply/fill it, Finish — or Decline. After everyone
// has signed, the same link shows the completed document for download.
import { useCallback, useEffect, useMemo, useState } from "react";
import { PdfPages, type PageGeom } from "@/components/esign/PdfPages";
import { SignaturePad } from "@/components/esign/SignaturePad";
import { STAMP_COLOR, autofillFor, fieldCaption, stampIdFor, type FieldType } from "@/components/esign/shared";

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
    // Name / Email boxes start pre-filled with the signer's own details.
    const auto: Record<string, string> = {};
    for (const f of v.fields) if (f.mine && f.type === "text" && !f.value) { const a = autofillFor(f.label, v.signer); if (a) auto[f.id] = a; }
    setValues((prev) => ({ ...auto, ...prev }));
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
    // Text boxes are typed into inline (see SignerField).
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
            <SignerField key={f.id} f={f} page={page} view={view} applied={isApplied(f)} value={values[f.id]} signature={signature} initials={initials} canSign={canSign && !done} onClick={() => clickField(f)} onText={(t) => setValues((v) => ({ ...v, [f.id]: t }))} />
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

// DocuSign-style frame around an applied signature/initials: left bracket,
// "Signed by:" caption, the signature, and the signature ID underneath.
function Stamp({ src, kind, signerId, height }: { src: string; kind: "signature" | "initials"; signerId: string; height: number }) {
  const roomy = height >= 34;
  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden border-l-[1.5px] pl-1" style={{ borderColor: STAMP_COLOR }}>
      {roomy && kind === "signature" && <span className="leading-none font-medium shrink-0" style={{ color: STAMP_COLOR, fontSize: Math.max(5, Math.min(7, height * 0.13)) }}>Signed by:</span>}
      <img src={src} alt="" className="flex-1 min-h-0 w-full object-contain object-left-bottom" />
      {roomy && <span className="leading-none shrink-0 tracking-wide" style={{ color: STAMP_COLOR, fontSize: Math.max(4.5, Math.min(6, height * 0.11)) }}>{stampIdFor(signerId)}</span>}
    </div>
  );
}

function SignerField({ f, page, view, applied, value, signature, initials, canSign, onClick, onText }: { f: Field; page: PageGeom; view: View; applied: boolean; value: string | boolean | undefined; signature: string | null; initials: string | null; canSign: boolean; onClick: () => void; onText: (t: string) => void }) {
  const color = view.signers.find((s) => s.id === f.signerId)?.color || "#2563eb";
  const style = { left: f.x * page.width, top: f.y * page.height, width: f.w * page.width, height: f.h * page.height };
  const boxH = f.h * page.height;
  const textSize = Math.max(10, Math.min(15, boxH * 0.55));
  // Someone else's (or my already-submitted) field: render its value.
  const submitted = !!f.value;
  if (!f.mine || submitted) {
    const sig = f.type === "signature" ? view.signatures[f.signerId]?.signature : f.type === "initials" ? view.signatures[f.signerId]?.initials : null;
    return (
      <div className="absolute" style={style} title={`${fieldCaption(f)} — ${view.signers.find((s) => s.id === f.signerId)?.name ?? ""}`}>
        {submitted && sig && (f.type === "signature" || f.type === "initials") && <Stamp src={sig} kind={f.type} signerId={f.signerId} height={boxH} />}
        {submitted && f.type === "checkbox" && f.value === "true" && <span className="w-full h-full flex items-center justify-center font-bold text-[#0b1a6b]">✕</span>}
        {submitted && (f.type === "date" || f.type === "text") && <span className="absolute left-0.5 top-1/2 -translate-y-1/2 text-[#0b1a6b] truncate max-w-full" style={{ fontSize: textSize }}>{f.value}</span>}
        {!submitted && <div className="absolute inset-0 rounded-sm border border-dashed opacity-60" style={{ borderColor: color }} />}
      </div>
    );
  }
  // A long text box: type straight into it (Name/Email arrive pre-filled).
  if (f.type === "text") {
    return (
      <div className={`absolute pointer-events-auto rounded-sm border-2 transition ${applied ? "border-emerald-500 bg-white/70" : ""}`} style={{ ...style, borderColor: applied ? "#10b981" : color, background: applied ? "rgba(255,255,255,0.7)" : `${color}2e` }} title={f.label || "Enter text"}>
        <input
          type="text"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onText(e.target.value)}
          disabled={!canSign}
          maxLength={500}
          placeholder={f.label || "Enter text"}
          className="absolute inset-0 w-full h-full bg-transparent outline-none px-1 text-[#0b1a6b] placeholder:font-semibold placeholder:text-slate-500/80"
          style={{ fontSize: textSize }}
        />
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
      title={applied ? "Click to change" : `Click to ${f.type === "signature" ? "sign" : f.type === "initials" ? "initial" : f.type === "date" ? "date" : "check"}`}
    >
      {applied && img && (f.type === "signature" || f.type === "initials") ? (
        <Stamp src={img} kind={f.type} signerId={view.signer.id} height={boxH} />
      ) : applied && f.type === "checkbox" ? (
        <span className="w-full h-full flex items-center justify-center font-bold text-[#0b1a6b]">✕</span>
      ) : applied ? (
        <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[#0b1a6b] truncate max-w-[95%]" style={{ fontSize: textSize }}>{String(value)}</span>
      ) : (
        <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[11px] font-semibold" style={{ color }}>{f.type === "signature" ? "Sign here" : f.type === "initials" ? "Initial" : f.type === "date" ? "Date" : ""}</span>
      )}
    </button>
  );
}

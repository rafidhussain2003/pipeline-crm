"use client";

// E-Sign → one document. Draft: add signers, click a page to place fields
// (drag to move, corner to resize), then Send. Sent/completed: track each
// signer, copy their link, resend, void, download the signed PDF.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PdfPages, type PageGeom } from "@/components/esign/PdfPages";
import { FIELD_DEFAULT, FIELD_LABEL, STATUS_STYLE, fmtWhen, type FieldType } from "@/components/esign/shared";

type Signer = { id: string; name: string; email: string; color: string; status: string; link: string; sentAt: string | null; viewedAt: string | null; signedAt: string | null; declinedAt: string | null; declineReason: string | null; ipAddress: string | null };
type Field = { id?: string; signerId: string; type: FieldType; page: number; x: number; y: number; w: number; h: number; required: boolean; label?: string | null; value?: string | null };
type Doc = { id: string; title: string; status: string; pageCount: number; message: string | null; sentAt: string | null; completedAt: string | null; voidReason: string | null };
type ShareLink = { id: string; url: string; signerId: string; expiresAt: string; uses: number; createdAt: string; expired: boolean };
type Copy = { id: string; title: string; status: string; createdAt: string; completedAt: string | null; signers: { name: string; email: string; status: string; signedAt: string | null }[] };
type Data = { doc: Doc & { parentDocumentId: string | null }; signers: Signer[]; fields: Field[]; events: { id: string; kind: string; detail: string | null; createdAt: string; signerId: string | null; ipAddress: string | null }[]; hasSignedFile: boolean; shareLink: ShareLink | null; copies: Copy[]; parent: { id: string; title: string } | null };

const TYPES: FieldType[] = ["signature", "initials", "date", "text", "checkbox"];

export default function EsignDocumentPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [signers, setSigners] = useState<{ id?: string; name: string; email: string; color?: string }[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [activeSigner, setActiveSigner] = useState<string>("");
  const [tool, setTool] = useState<FieldType>("signature");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The authoritative field list. Every edit reads from and writes to this
  // ref, so two clicks in quick succession never see a stale list.
  const fieldsRef = useRef<Field[]>([]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/esign/${id}`);
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || "Not found"); return; }
    const d: Data = await res.json();
    setData(d);
    setSigners(d.signers.map((s) => ({ id: s.id, name: s.name, email: s.email, color: s.color })));
    fieldsRef.current = d.fields;
    setFields(d.fields);
    setMessage(d.doc.message || "");
    setActiveSigner((a) => a || d.signers[0]?.id || "");
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const isDraft = data?.doc.status === "draft";

  async function saveSigners(list: { id?: string; name: string; email: string }[]) {
    setBusy(true); setError("");
    const res = await fetch(`/api/esign/${id}/signers`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ signers: list }) });
    setBusy(false);
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || "Could not save signers"); return; }
    const saved: Signer[] = (await res.json()).signers;
    setSigners(saved.map((s) => ({ id: s.id, name: s.name, email: s.email, color: s.color })));
    // Fields of a removed signer are gone server-side; mirror that.
    fieldsRef.current = fieldsRef.current.filter((x) => saved.some((s) => s.id === x.signerId));
    setFields(fieldsRef.current);
    if (!saved.some((s) => s.id === activeSigner)) setActiveSigner(saved[0]?.id || "");
  }

  // Fields auto-save (debounced) whenever they change in a draft.
  const persistFields = useCallback(async (list: Field[]) => {
    const res = await fetch(`/api/esign/${id}/fields`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields: list }) });
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || "Could not save fields"); return; }
    const saved: Field[] = (await res.json()).fields;
    fieldsRef.current = saved;
    setFields(saved); setDirty(false);
  }, [id]);
  const scheduleSave = (list: Field[]) => {
    fieldsRef.current = list;
    setFields(list); setDirty(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persistFields(fieldsRef.current), 600);
  };

  function placeField(page: PageGeom, fx: number, fy: number) {
    if (!isDraft || !activeSigner) { if (!activeSigner) setError("Add a signer first, then click the page to place a field."); return; }
    const def = FIELD_DEFAULT[tool];
    const w = def.w, h = def.h * (page.width / page.height) * 1.294; // keep the default box the same visual size on any page aspect
    scheduleSave([...fieldsRef.current, { signerId: activeSigner, type: tool, page: page.index, x: Math.min(Math.max(0, fx - w / 2), 1 - w), y: Math.min(Math.max(0, fy - h / 2), 1 - h), w, h, required: true }]);
  }

  async function send() {
    setSending(true); setError("");
    if (dirty) await persistFields(fields);
    const res = await fetch(`/api/esign/${id}/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) });
    setSending(false);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setError(d.error || "Could not send"); return; }
    const failed = (d.results || []).filter((r: { ok: boolean }) => !r.ok);
    setNotice(failed.length === 0 ? "Sent. Every signer has been emailed their private link." : `Sent, but ${failed.length} email${failed.length === 1 ? "" : "s"} could not be delivered (${failed[0].reason || "email not configured"}). You can copy each signer's link below and share it yourself.`);
    await load();
  }
  async function act(path: string, body: unknown, ok: string) {
    setBusy(true); setError(""); setNotice("");
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || "Something went wrong"); return; }
    setNotice(ok); await load();
  }

  async function makeLink(signerId: string) {
    setBusy(true); setError(""); setNotice("");
    const res = await fetch(`/api/esign/${id}/link`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ signerId }) });
    setBusy(false);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setError(d.error || "Could not generate the link"); return; }
    try { await navigator.clipboard?.writeText(d.shareLink.url); setNotice("Share link generated and copied. It works for 24 hours."); } catch { setNotice("Share link generated. It works for 24 hours."); }
    await load();
  }
  async function disableLink() {
    if (!confirm("Disable this share link? Anyone who opens it afterwards will be told it's no longer available.")) return;
    setBusy(true); setError(""); setNotice("");
    const res = await fetch(`/api/esign/${id}/link`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || "Could not disable the link"); return; }
    setNotice("Share link disabled."); await load();
  }

  if (error && !data) return <div className="p-6"><p className="text-sm text-red-600">{error}</p><Link href="/esign" className="text-sm text-blue-700 hover:underline">← Docusign</Link></div>;
  if (!data) return <div className="p-6 text-sm text-slate-400">Loading…</div>;
  const signerById = new Map(data.signers.map((s) => [s.id, s]));
  const colorOf = (sid: string) => signers.find((s) => s.id === sid)?.color || signerById.get(sid)?.color || "#2563eb";

  return (
    <div className="p-6 max-w-6xl">
      <Link href="/esign" className="text-sm text-blue-700 hover:underline">← Docusign</Link>
      <div className="flex flex-wrap items-start justify-between gap-3 mt-2 mb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 flex items-center gap-2">{data.doc.title} <span className={`text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${STATUS_STYLE[data.doc.status] || ""}`}>{data.doc.status}</span></h1>
          {data.parent && <p className="text-xs text-violet-700 mt-1">Signed through a share link · copy of <Link href={`/esign/${data.parent.id}`} className="underline">{data.parent.title}</Link></p>}
          <p className="text-xs text-slate-500 mt-1">{data.doc.pageCount} page{data.doc.pageCount === 1 ? "" : "s"}{data.doc.sentAt ? ` · sent ${fmtWhen(data.doc.sentAt)}` : ""}{data.doc.completedAt ? ` · completed ${fmtWhen(data.doc.completedAt)}` : ""}{data.doc.voidReason ? ` · voided: ${data.doc.voidReason}` : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <a href={`/api/esign/${id}/file?download=1`} className="text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 px-3 py-2 rounded-md">Original PDF</a>
          {data.hasSignedFile && <a href={`/api/esign/${id}/signed?download=1`} className="text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-2 rounded-md">Download signed PDF</a>}
          {data.doc.status === "sent" && <button onClick={() => { const r = prompt("Void this document? Signers' links stop working. Reason (optional):"); if (r !== null) act(`/api/esign/${id}/void`, { reason: r }, "Document voided."); }} disabled={busy} className="text-sm font-medium text-red-600 bg-red-50 px-3 py-2 rounded-md disabled:opacity-50">Void</button>}
          {isDraft && <button onClick={() => { if (confirm("Delete this draft?")) fetch(`/api/esign/${id}`, { method: "DELETE" }).then(() => { window.location.href = "/esign"; }); }} className="text-sm font-medium text-slate-500 px-3 py-2 rounded-md hover:bg-slate-50">Delete draft</button>}
        </div>
      </div>
      {notice && <p className="text-xs text-emerald-700 mb-3">{notice}</p>}
      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5">
        {/* ── Left: signers + tools / tracking ── */}
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <h2 className="text-sm font-semibold text-slate-900 mb-2">Signers</h2>
            {isDraft ? (
              <SignerEditor signers={signers} busy={busy} onSave={saveSigners} />
            ) : (
              <ul className="space-y-2">
                {data.signers.map((s) => (
                  <li key={s.id} className="text-sm">
                    <div className="flex items-center gap-2">
                      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
                      <span className="font-medium text-slate-900 truncate">{s.name}</span>
                      <span className={`ml-auto text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${STATUS_STYLE[s.status] || ""}`}>{s.status}</span>
                    </div>
                    <div className="text-xs text-slate-400 truncate">{s.email || "no email · signs through the share link"}</div>
                    <div className="text-[11px] text-slate-400">
                      {s.signedAt ? `Signed ${fmtWhen(s.signedAt)}${s.ipAddress ? ` · ${s.ipAddress}` : ""}` : s.declinedAt ? `Declined ${fmtWhen(s.declinedAt)}${s.declineReason ? ` — ${s.declineReason}` : ""}` : s.viewedAt ? `Viewed ${fmtWhen(s.viewedAt)}` : s.sentAt ? `Sent ${fmtWhen(s.sentAt)}` : ""}
                    </div>
                    {data.doc.status === "sent" && s.status !== "signed" && (
                      <div className="flex gap-2 mt-1">
                        <button onClick={() => { navigator.clipboard?.writeText(s.link); setNotice(`Link for ${s.name} copied.`); }} className="text-[11px] font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded px-2 py-0.5">Copy link</button>
                        {s.email && <button onClick={() => act(`/api/esign/${id}/remind`, { signerId: s.id }, `Reminder sent to ${s.email}.`)} disabled={busy} className="text-[11px] font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded px-2 py-0.5 disabled:opacity-50">Resend email</button>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {isDraft && (
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <h2 className="text-sm font-semibold text-slate-900 mb-1">Place fields</h2>
              <p className="text-[11px] text-slate-500 mb-3">Pick a signer and a field type, then click on the page where it should go. Drag to move; drag the corner to resize; × removes.</p>
              <label className="block text-xs font-semibold text-slate-600 mb-1">For signer</label>
              <select value={activeSigner} onChange={(e) => setActiveSigner(e.target.value)} className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm bg-white mb-3">
                {signers.filter((s) => s.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                {signers.filter((s) => s.id).length === 0 && <option value="">Add a signer first</option>}
              </select>
              <div className="grid grid-cols-2 gap-1.5">
                {TYPES.map((t) => (
                  <button key={t} type="button" onClick={() => setTool(t)} className={`text-xs font-medium px-2 py-1.5 rounded border ${tool === t ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"}`}>{FIELD_LABEL[t]}</button>
                ))}
              </div>
              <div className="text-[11px] text-slate-400 mt-3">{fields.length} field{fields.length === 1 ? "" : "s"} placed{dirty ? " · saving…" : ""}</div>
            </div>
          )}

          {isDraft && (
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <h2 className="text-sm font-semibold text-slate-900 mb-1">Send</h2>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Message to signers (optional)</label>
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={2000} placeholder="Please review and sign by Friday." className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm mb-3" />
              <button onClick={send} disabled={sending || busy || signers.length === 0 || fields.length === 0} className="w-full bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-40">{sending ? "Sending…" : "Send for signature"}</button>
              <p className="text-[11px] text-slate-400 mt-2">Every signer needs at least one signature field. Once sent, the document is locked.</p>
            </div>
          )}

          {(isDraft || data.doc.status === "sent") && !data.parent && (
            <ShareLinkCard link={data.shareLink} signers={signers.filter((s) => s.id) as { id: string; name: string }[]} busy={busy} onGenerate={makeLink} onDisable={disableLink} onNotice={setNotice} />
          )}

          {data.copies.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <h2 className="text-sm font-semibold text-slate-900 mb-1">Signed through the link</h2>
              <p className="text-[11px] text-slate-500 mb-2">Each person who opened the share link got their own copy.</p>
              <ul className="space-y-2 max-h-72 overflow-y-auto">
                {data.copies.map((c) => {
                  const who = c.signers.find((s) => s.status !== "pending") ?? c.signers[0];
                  return (
                    <li key={c.id} className="text-sm">
                      <Link href={`/esign/${c.id}`} className="flex items-center gap-2 hover:underline">
                        <span className="font-medium text-slate-900 truncate">{who?.name ?? "—"}</span>
                        <span className={`ml-auto text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${STATUS_STYLE[c.status] || ""}`}>{c.status}</span>
                      </Link>
                      <div className="text-xs text-slate-400 truncate">{who?.email}{c.completedAt ? ` · signed ${fmtWhen(c.completedAt)}` : ` · opened ${fmtWhen(c.createdAt)}`}</div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {!isDraft && (
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <h2 className="text-sm font-semibold text-slate-900 mb-2">Activity</h2>
              <ul className="space-y-1.5 text-[11px] text-slate-500 max-h-72 overflow-y-auto">
                {[...data.events].reverse().map((e) => (
                  <li key={e.id}><span className="text-slate-400">{fmtWhen(e.createdAt)}</span> · <span className="font-medium text-slate-700 uppercase">{e.kind}</span>{e.signerId ? ` · ${signerById.get(e.signerId)?.name ?? ""}` : ""}{e.detail ? ` — ${e.detail}` : ""}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* ── Right: the document with fields ── */}
        <div className="min-w-0">
          <PdfPages
            src={`/api/esign/${id}/file`}
            onPageClick={isDraft ? placeField : undefined}
            renderOverlay={(page) => fields.map((f, i) => f.page === page.index && (
              <FieldBox
                key={f.id ?? `n${i}`}
                field={f}
                page={page}
                color={colorOf(f.signerId)}
                signerName={signers.find((s) => s.id === f.signerId)?.name || signerById.get(f.signerId)?.name || ""}
                editable={!!isDraft}
                onChange={(nf) => scheduleSave(fieldsRef.current.map((x) => (x === f ? nf : x)))}
                onRemove={() => scheduleSave(fieldsRef.current.filter((x) => x !== f))}
              />
            ))}
          />
        </div>
      </div>
    </div>
  );
}

function SignerEditor({ signers, busy, onSave }: { signers: { id?: string; name: string; email: string; color?: string }[]; busy: boolean; onSave: (list: { id?: string; name: string; email: string }[]) => Promise<void> }) {
  const [list, setList] = useState(signers);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  useEffect(() => { setList(signers); }, [signers]);
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await onSave([...list, { name: name.trim(), email: email.trim() }]);
    setName(""); setEmail("");
  }
  return (
    <div>
      <ul className="space-y-1.5 mb-3">
        {list.map((s, i) => (
          <li key={s.id ?? i} className="flex items-center gap-2 text-sm">
            <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color || "#2563eb" }} />
            <span className="min-w-0 flex-1"><span className="font-medium text-slate-900">{s.name}</span> <span className="text-xs text-slate-400">{s.email || "link only"}</span></span>
            <button type="button" onClick={() => onSave(list.filter((_, j) => j !== i))} disabled={busy} className="text-slate-400 hover:text-red-600 text-sm px-1" title="Remove signer">×</button>
          </li>
        ))}
        {list.length === 0 && <li className="text-xs text-slate-400">No signers yet.</li>}
      </ul>
      <form onSubmit={add} className="space-y-1.5">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" required maxLength={160} className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com (optional)" maxLength={200} className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
        <button type="submit" disabled={busy} className="w-full text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded px-2 py-1.5 disabled:opacity-50">+ Add signer</button>
        <p className="text-[11px] text-slate-400">Leave the email blank for a signer you&apos;ll reach with a share link — whoever opens it fills in their own name and email.</p>
      </form>
    </div>
  );
}

// Share link: one live 24-hour link per document. Anyone who opens it signs
// their own copy in the chosen signer's place — no email or account needed.
function ShareLinkCard({ link, signers, busy, onGenerate, onDisable, onNotice }: { link: ShareLink | null; signers: { id: string; name: string }[]; busy: boolean; onGenerate: (signerId: string) => Promise<void>; onDisable: () => Promise<void>; onNotice: (s: string) => void }) {
  const [slot, setSlot] = useState(link?.signerId || signers[0]?.id || "");
  // Clock ticks in an effect (never during render) so the countdown stays live.
  const [now, setNow] = useState(0);
  useEffect(() => { if (!signers.some((s) => s.id === slot)) setSlot(signers[0]?.id || ""); }, [signers, slot]);
  useEffect(() => { setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const live = link && !link.expired && (now === 0 || new Date(link.expiresAt).getTime() > now);
  const left = live ? Math.max(0, new Date(link!.expiresAt).getTime() - now) : 0;
  const leftLabel = left >= 3600_000 ? `${Math.floor(left / 3600_000)}h ${Math.floor((left % 3600_000) / 60_000)}m` : `${Math.max(1, Math.floor(left / 60_000))}m`;
  const slotName = signers.find((s) => s.id === (live ? link!.signerId : slot))?.name;
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <h2 className="text-sm font-semibold text-slate-900 mb-1">Share link</h2>
      <p className="text-[11px] text-slate-500 mb-3">Anyone with the link can sign — no sign-up or sign-in. They enter their name and email, get their own copy to sign, and the signed PDF is emailed to them and you. The link expires 24 hours after you generate it.</p>
      {live ? (
        <>
          <div className="flex gap-1.5">
            <input readOnly value={link!.url} onFocus={(e) => e.currentTarget.select()} className="flex-1 min-w-0 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700" />
            <button type="button" onClick={() => { navigator.clipboard?.writeText(link!.url); onNotice("Share link copied."); }} className="text-xs font-medium text-white bg-slate-900 rounded-md px-3 py-1.5">Copy</button>
          </div>
          <div className="text-[11px] text-slate-500 mt-2">Signs as <span className="font-medium text-slate-700">{slotName}</span> · expires in <span className="font-medium text-slate-700">{leftLabel}</span> ({fmtWhen(link!.expiresAt)}) · opened {link!.uses} time{link!.uses === 1 ? "" : "s"}</div>
          <div className="flex gap-2 mt-3">
            <button type="button" onClick={() => onGenerate(link!.signerId)} disabled={busy} className="text-[11px] font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded px-2 py-1 disabled:opacity-50">Regenerate (new 24h)</button>
            <button type="button" onClick={onDisable} disabled={busy} className="text-[11px] font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded px-2 py-1 disabled:opacity-50">Disable link</button>
          </div>
        </>
      ) : (
        <>
          {link && <p className="text-[11px] text-amber-700 bg-amber-50 rounded px-2 py-1.5 mb-3">The previous link expired {fmtWhen(link.expiresAt)} after {link.uses} use{link.uses === 1 ? "" : "s"}. Generate a new one to keep collecting signatures.</p>}
          {signers.length > 1 && (
            <>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Whoever opens the link signs as</label>
              <select value={slot} onChange={(e) => setSlot(e.target.value)} className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm bg-white mb-3">
                {signers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </>
          )}
          <button type="button" onClick={() => onGenerate(slot)} disabled={busy || !slot} className="w-full text-sm font-medium text-slate-900 bg-white border border-slate-300 hover:bg-slate-50 rounded-md px-3 py-2 disabled:opacity-40">{signers.length === 0 ? "Add a signer first" : "Generate 24-hour share link"}</button>
          {signers.length > 0 && <p className="text-[11px] text-slate-400 mt-2">Place at least one signature field for {slotName || "that signer"} first.</p>}
        </>
      )}
    </div>
  );
}

// A placed field: drag to move, corner handle to resize, × to delete.
function FieldBox({ field, page, color, signerName, editable, onChange, onRemove }: { field: Field; page: PageGeom; color: string; signerName: string; editable: boolean; onChange: (f: Field) => void; onRemove: () => void }) {
  const drag = useRef<{ mode: "move" | "resize"; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number } | null>(null);
  function beginDrag(mode: "move" | "resize", e: React.PointerEvent) {
    if (!editable) return;
    e.stopPropagation(); e.preventDefault();
    drag.current = { mode, sx: e.clientX, sy: e.clientY, ox: field.x, oy: field.y, ow: field.w, oh: field.h };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = (e.clientX - d.sx) / page.width, dy = (e.clientY - d.sy) / page.height;
    if (d.mode === "move") onChange({ ...field, x: Math.min(Math.max(0, d.ox + dx), 1 - field.w), y: Math.min(Math.max(0, d.oy + dy), 1 - field.h) });
    else onChange({ ...field, w: Math.min(Math.max(0.02, d.ow + dx), 1 - field.x), h: Math.min(Math.max(0.01, d.oh + dy), 1 - field.y) });
  };
  const end = () => { drag.current = null; };
  return (
    <div
      className={`absolute pointer-events-auto rounded-sm border-2 text-[10px] leading-none ${editable ? "cursor-move" : ""}`}
      style={{ left: field.x * page.width, top: field.y * page.height, width: field.w * page.width, height: field.h * page.height, borderColor: color, background: `${color}22` }}
      onPointerDown={(e) => beginDrag("move", e)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
      onClick={(e) => e.stopPropagation()}
      title={`${FIELD_LABEL[field.type]} — ${signerName}`}
    >
      <div className="absolute inset-0 overflow-hidden">
        <span className="absolute left-1 top-0.5 font-semibold truncate max-w-[90%]" style={{ color }}>{FIELD_LABEL[field.type]}{field.value ? " ✓" : ""}</span>
        <span className="absolute left-1 bottom-0.5 text-[9px] truncate max-w-[90%] opacity-80" style={{ color }}>{signerName}</span>
      </div>
      {editable && (
        <>
          {/* × sits OUTSIDE the top-right corner so it never collides with the
              resize handle, even on a checkbox-sized field. */}
          <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onRemove(); }} className="absolute -right-2.5 -top-2.5 w-5 h-5 text-[12px] leading-5 text-white rounded-full shadow" style={{ background: color }} title="Remove">×</button>
          <span onPointerDown={(e) => beginDrag("resize", e)} className="absolute right-0 bottom-0 w-3 h-3 cursor-se-resize" style={{ background: color }} />
        </>
      )}
    </div>
  );
}

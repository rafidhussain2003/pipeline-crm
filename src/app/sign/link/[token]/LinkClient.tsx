"use client";

// Share-link landing: who are you? → your own copy of the document opens on
// the normal signing page. The link itself is valid for 24 hours.
import { useEffect, useState } from "react";

type Info = { title: string; pageCount: number; sender: string; message: string | null; expiresAt: string; role: string };

export function LinkClient({ token }: { token: string }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/sign/link/${token}`).then(async (res) => {
      if (!res.ok) { setError((await res.json().catch(() => ({}))).error || "This link is not valid."); return; }
      setInfo(await res.json());
    }).catch(() => setError("Could not load this link. Please try again."));
  }, [token]);

  async function go(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const res = await fetch(`/api/sign/link/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setBusy(false); setError(d.error || "Something went wrong. Please try again."); return; }
    window.location.href = d.url;
  }

  const expires = info ? new Date(info.expiresAt) : null;
  const [hoursLeft, setHoursLeft] = useState(24);
  useEffect(() => { if (expires) setHoursLeft(Math.max(0, Math.round((expires.getTime() - Date.now()) / 36e5))); }, [info]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col">
      <div className="flex-1 flex items-start justify-center px-4 pt-16 pb-8">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-sm p-7">
          {!info && !error && <p className="text-sm text-slate-400 text-center">Loading…</p>}
          {!info && error && (
            <div className="text-center">
              <h1 className="text-lg font-semibold text-slate-900">Link not available</h1>
              <p className="text-sm text-slate-500 mt-2">{error}</p>
            </div>
          )}
          {info && (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Document to sign</p>
              <h1 className="text-lg font-semibold text-slate-900 mt-1">{info.title}</h1>
              <p className="text-xs text-slate-500 mt-1">From {info.sender} · {info.pageCount} page{info.pageCount === 1 ? "" : "s"} · you sign as <span className="font-medium text-slate-700">{info.role}</span></p>
              {info.message && <p className="text-sm text-slate-600 italic mt-3 border-l-2 border-slate-200 pl-3">&ldquo;{info.message}&rdquo;</p>}
              <form onSubmit={go} className="mt-6 space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Your full name</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={160} autoComplete="name" placeholder="Jane Doe" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Your email</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={200} autoComplete="email" placeholder="jane@example.com" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
                  <p className="text-[11px] text-slate-400 mt-1">The signed copy will be emailed to this address. No account or password needed.</p>
                </div>
                {error && <p className="text-xs text-red-600">{error}</p>}
                <button type="submit" disabled={busy} className="w-full bg-slate-900 text-white text-sm font-medium px-4 py-2.5 rounded-md disabled:opacity-50">{busy ? "Opening your document…" : "Continue to sign"}</button>
              </form>
              <p className="text-[11px] text-slate-400 mt-4 text-center">This link expires {hoursLeft <= 1 ? "within the hour" : `in about ${hoursLeft} hours`} ({expires!.toLocaleString()}).</p>
            </>
          )}
        </div>
      </div>
      <p className="text-center text-[11px] text-slate-400 py-6">Secured by Ziplod Docusign · each action is time-stamped with your IP address</p>
    </div>
  );
}

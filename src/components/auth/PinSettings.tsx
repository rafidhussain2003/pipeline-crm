"use client";

import { useEffect, useState } from "react";

// Personal Login-PIN management (Profile → Security). Set, change, disable, or
// reset (via an emailed code) your own 4-digit PIN. Distinct from the full-
// screen PinGate: this is opt-in self-service, not a hard block.
export default function PinSettings() {
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [required, setRequired] = useState(false);
  const [mode, setMode] = useState<null | "set" | "change" | "disable" | "reset">(null);
  const [message, setMessage] = useState("");

  function load() {
    fetch("/api/auth/pin")
      .then((r) => r.json())
      .then((d) => {
        setHasPin(!!d.hasPin);
        setRequired(!!d.required);
      })
      .catch(() => {});
  }
  useEffect(() => {
    load();
  }, []);

  function done(msg: string) {
    setMode(null);
    setMessage(msg);
    load();
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">Login PIN</h2>
          <p className="text-xs text-slate-500 mt-0.5 max-w-md">
            An extra 4-digit code asked only after a fresh sign-in or ~1 hour of inactivity. Your login and
            &ldquo;Remember me&rdquo; are unaffected.
          </p>
        </div>
        {hasPin !== null && (
          <span className={`text-xs font-semibold rounded-full px-2.5 py-1 ${hasPin ? "text-emerald-800 bg-emerald-100" : "text-slate-500 bg-slate-100"}`}>
            {hasPin ? "On" : "Off"}
          </span>
        )}
      </div>

      {message && <p className="text-xs text-emerald-700 mt-3">{message}</p>}

      {mode === null && (
        <div className="flex flex-wrap gap-2 mt-4">
          {!hasPin && (
            <button onClick={() => { setMessage(""); setMode("set"); }} className="text-sm font-medium text-white bg-slate-900 rounded-md px-3 py-2">
              Set a PIN
            </button>
          )}
          {hasPin && (
            <>
              <button onClick={() => { setMessage(""); setMode("change"); }} className="text-sm font-medium text-slate-700 bg-slate-100 rounded-md px-3 py-2">
                Change PIN
              </button>
              <button onClick={() => { setMessage(""); setMode("reset"); }} className="text-sm font-medium text-slate-700 bg-slate-100 rounded-md px-3 py-2">
                Forgot / Reset
              </button>
              {!required && (
                <button onClick={() => { setMessage(""); setMode("disable"); }} className="text-sm font-medium text-red-700 bg-red-50 rounded-md px-3 py-2">
                  Turn off
                </button>
              )}
            </>
          )}
        </div>
      )}

      {mode && mode !== "reset" && <SetChangeDisable mode={mode} onDone={done} onCancel={() => setMode(null)} />}
      {mode === "reset" && <ResetForm onDone={done} onCancel={() => setMode(null)} />}
    </div>
  );
}

function PinField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
        inputMode="numeric"
        autoComplete="off"
        placeholder="••••"
        className="w-28 rounded-md border border-slate-200 px-3 py-2 text-center text-lg tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}

function SetChangeDisable({ mode, onDone, onCancel }: { mode: "set" | "change" | "disable"; onDone: (m: string) => void; onCancel: () => void }) {
  const [current, setCurrent] = useState("");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (mode !== "disable" && pin !== confirm) return setError("The two PINs don't match.");
    setBusy(true);
    let res: Response;
    if (mode === "disable") {
      res = await fetch("/api/auth/pin", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPin: current }) });
    } else {
      res = await fetch("/api/auth/pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin, ...(mode === "change" ? { currentPin: current } : {}) }) });
    }
    setBusy(false);
    if (res.ok) return onDone(mode === "set" ? "PIN set." : mode === "change" ? "PIN changed." : "PIN turned off.");
    setError((await res.json().catch(() => ({}))).error || "Something went wrong.");
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3 border-t border-slate-100 pt-4">
      {(mode === "change" || mode === "disable") && <PinField label="Current PIN" value={current} onChange={setCurrent} />}
      {mode !== "disable" && (
        <div className="flex gap-4">
          <PinField label={mode === "set" ? "New PIN" : "New PIN"} value={pin} onChange={setPin} />
          <PinField label="Confirm PIN" value={confirm} onChange={setConfirm} />
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={`text-sm font-medium text-white rounded-md px-3 py-2 disabled:opacity-40 ${mode === "disable" ? "bg-red-600" : "bg-slate-900"}`}>
          {busy ? "Saving…" : mode === "set" ? "Set PIN" : mode === "change" ? "Change PIN" : "Turn off PIN"}
        </button>
        <button type="button" onClick={onCancel} className="text-sm font-medium text-slate-500 px-3 py-2">Cancel</button>
      </div>
    </form>
  );
}

function ResetForm({ onDone, onCancel }: { onDone: (m: string) => void; onCancel: () => void }) {
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    setError("");
    setBusy(true);
    const res = await fetch("/api/auth/pin/forgot", { method: "POST" });
    setBusy(false);
    const d = await res.json().catch(() => ({}));
    if (res.ok) { setSent(true); setNotice(d.message || "A code is on its way to your email."); }
    else setError(d.error || "Could not send a code.");
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (pin !== confirm) return setError("The two PINs don't match.");
    setBusy(true);
    const res = await fetch("/api/auth/pin/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, pin }) });
    setBusy(false);
    if (res.ok) return onDone("PIN reset.");
    setError((await res.json().catch(() => ({}))).error || "Could not reset your PIN.");
  }

  return (
    <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
      {!sent ? (
        <>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={send} disabled={busy} className="text-sm font-medium text-white bg-slate-900 rounded-md px-3 py-2 disabled:opacity-40">
              {busy ? "Sending…" : "Email me a reset code"}
            </button>
            <button onClick={onCancel} className="text-sm font-medium text-slate-500 px-3 py-2">Cancel</button>
          </div>
        </>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          {notice && <p className="text-xs text-slate-500">{notice}</p>}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Code from email</label>
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" placeholder="6-digit code" className="w-40 rounded-md border border-slate-200 px-3 py-2 text-sm tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex gap-4">
            <PinField label="New PIN" value={pin} onChange={setPin} />
            <PinField label="Confirm PIN" value={confirm} onChange={setConfirm} />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="text-sm font-medium text-white bg-slate-900 rounded-md px-3 py-2 disabled:opacity-40">
              {busy ? "Saving…" : "Set new PIN"}
            </button>
            <button type="button" onClick={onCancel} className="text-sm font-medium text-slate-500 px-3 py-2">Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

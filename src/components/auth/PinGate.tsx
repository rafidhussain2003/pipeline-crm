"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// The full-screen PIN gate. `unlock` = the user has a PIN and this session
// needs to re-enter it (fresh login / after inactivity). `setup` = the
// company requires a PIN and this agent hasn't set one yet (no skip).
// A "Forgot PIN?" path emails a reset code and sets a new one.
export default function PinGate({ mode }: { mode: "unlock" | "setup" }) {
  const router = useRouter();
  const [view, setView] = useState<"main" | "reset">("main");

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="flex items-center justify-center gap-2 text-2xl font-bold text-slate-900 tracking-tight">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-slate-900 text-white text-sm">Z</span>
            Ziplod
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-6">
          {view === "reset" ? (
            <ResetView onDone={() => router.refresh()} onBack={() => setView("main")} />
          ) : mode === "setup" ? (
            <SetupView onDone={() => router.refresh()} />
          ) : (
            <UnlockView onDone={() => router.refresh()} onForgot={() => setView("reset")} />
          )}
        </div>
        <SignOut />
      </div>
    </div>
  );
}

function PinInput({ value, onChange, label, autoFocus }: { value: string; onChange: (v: string) => void; label: string; autoFocus?: boolean }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
        inputMode="numeric"
        autoComplete="off"
        placeholder="••••"
        className="w-full rounded-md border border-slate-200 px-3 py-2.5 text-center text-2xl tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}

function UnlockView({ onDone, onForgot }: { onDone: () => void; onForgot: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const res = await fetch("/api/auth/pin/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) });
    setBusy(false);
    if (res.ok) return onDone();
    setPin("");
    setError((await res.json().catch(() => ({}))).error || "Incorrect PIN.");
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Enter your PIN</h1>
        <p className="text-sm text-slate-500 mt-0.5">For security, confirm your 4-digit PIN to continue.</p>
      </div>
      <PinInput value={pin} onChange={setPin} label="4-digit PIN" autoFocus />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={busy || pin.length !== 4} className="w-full bg-slate-900 text-white text-sm font-medium py-2.5 rounded-md disabled:opacity-40">
        {busy ? "Checking…" : "Unlock"}
      </button>
      <button type="button" onClick={onForgot} className="w-full text-xs text-slate-500 hover:text-slate-700">
        Forgot your PIN?
      </button>
    </form>
  );
}

function SetupView({ onDone }: { onDone: () => void }) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (pin !== confirm) return setError("The two PINs don't match.");
    setBusy(true);
    const res = await fetch("/api/auth/pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) });
    setBusy(false);
    if (res.ok) return onDone();
    setError((await res.json().catch(() => ({}))).error || "Could not set your PIN.");
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Set a login PIN</h1>
        <p className="text-sm text-slate-500 mt-0.5">Your company requires a 4-digit PIN as an extra security step at sign-in.</p>
      </div>
      <PinInput value={pin} onChange={setPin} label="Choose a 4-digit PIN" autoFocus />
      <PinInput value={confirm} onChange={setConfirm} label="Confirm PIN" />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={busy || pin.length !== 4 || confirm.length !== 4} className="w-full bg-slate-900 text-white text-sm font-medium py-2.5 rounded-md disabled:opacity-40">
        {busy ? "Saving…" : "Set PIN & Continue"}
      </button>
    </form>
  );
}

function ResetView({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function sendCode() {
    setError("");
    setBusy(true);
    const res = await fetch("/api/auth/pin/forgot", { method: "POST" });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setSent(true);
      setNotice(data.message || "A reset code is on its way to your email.");
    } else {
      setError(data.error || "Could not send a code.");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (pin !== confirm) return setError("The two PINs don't match.");
    setBusy(true);
    const res = await fetch("/api/auth/pin/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, pin }) });
    setBusy(false);
    if (res.ok) return onDone();
    setError((await res.json().catch(() => ({}))).error || "Could not reset your PIN.");
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Reset your PIN</h1>
        <p className="text-sm text-slate-500 mt-0.5">We&apos;ll email a code to the address on your account.</p>
      </div>
      {!sent ? (
        <>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button onClick={sendCode} disabled={busy} className="w-full bg-slate-900 text-white text-sm font-medium py-2.5 rounded-md disabled:opacity-40">
            {busy ? "Sending…" : "Email me a code"}
          </button>
        </>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {notice && <p className="text-xs text-slate-500">{notice}</p>}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Verification code</label>
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" placeholder="6-digit code" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <PinInput value={pin} onChange={setPin} label="New 4-digit PIN" />
          <PinInput value={confirm} onChange={setConfirm} label="Confirm new PIN" />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={busy || pin.length !== 4} className="w-full bg-slate-900 text-white text-sm font-medium py-2.5 rounded-md disabled:opacity-40">
            {busy ? "Saving…" : "Set new PIN"}
          </button>
        </form>
      )}
      <button type="button" onClick={onBack} className="w-full text-xs text-slate-500 hover:text-slate-700">
        Back
      </button>
    </div>
  );
}

function SignOut() {
  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/login";
  }
  return (
    <button onClick={signOut} className="w-full text-center text-xs text-slate-400 hover:text-slate-600 mt-4">
      Sign out
    </button>
  );
}

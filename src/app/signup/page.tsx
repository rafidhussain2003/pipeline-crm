"use client";

// Phase 13 — polished multi-step signup: name + company + email → 6-digit code
// → create password → company created → onboarding. Verification codes expire
// in 10 min with a 60s resend cooldown.
import { useEffect, useState } from "react";
import Link from "next/link";

export default function SignupPage() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function requestCode() {
    setError(""); setBusy(true);
    const res = await fetch("/api/auth/verify-email/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, companyName, email }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(typeof data.error === "string" ? data.error : "Could not send a code. Check your details.");
    setStep(2); setCooldown(60);
  }
  async function verify() {
    setError(""); setBusy(true);
    const res = await fetch("/api/auth/verify-email/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, code }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(typeof data.error === "string" ? data.error : "Incorrect code.");
    setToken(data.token); setStep(3); setError("");
  }
  async function register() {
    setError("");
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (password !== confirm) return setError("Passwords don't match.");
    setBusy(true);
    const res = await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(typeof data.error === "string" ? data.error : "Could not create your account.");
    window.location.href = "/onboarding";
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6"><div className="text-2xl font-bold text-slate-900">Ziplod</div><p className="text-sm text-slate-500 mt-1">Start your 7-day free trial — no card required.</p></div>
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
          <div className="flex gap-1.5 mb-5">{[1, 2, 3].map((s) => <div key={s} className={`h-1 flex-1 rounded-full ${step >= s ? "bg-slate-900" : "bg-slate-200"}`} />)}</div>

          {step === 1 && (
            <form onSubmit={(e) => { e.preventDefault(); requestCode(); }} className="space-y-3">
              <h1 className="text-lg font-semibold text-slate-900">Create your account</h1>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" required />
              <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Company name" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" required />
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Work email" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" required />
              {error && <p className="text-xs text-red-600">{error}</p>}
              <button type="submit" disabled={busy} className="w-full bg-slate-900 text-white text-sm font-medium px-4 py-2.5 rounded-md disabled:opacity-50">{busy ? "Sending…" : "Continue"}</button>
            </form>
          )}

          {step === 2 && (
            <form onSubmit={(e) => { e.preventDefault(); verify(); }} className="space-y-3">
              <h1 className="text-lg font-semibold text-slate-900">Verify your email</h1>
              <p className="text-sm text-slate-500">We sent a 6-digit code to <strong>{email}</strong>. It expires in 10 minutes.</p>
              <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" inputMode="numeric" className="w-full rounded-md border border-slate-300 px-3 py-2 text-center text-lg tracking-[6px] font-mono" required />
              {error && <p className="text-xs text-red-600">{error}</p>}
              <button type="submit" disabled={busy || code.length < 6} className="w-full bg-slate-900 text-white text-sm font-medium px-4 py-2.5 rounded-md disabled:opacity-50">{busy ? "Verifying…" : "Verify"}</button>
              <button type="button" disabled={cooldown > 0} onClick={requestCode} className="w-full text-xs text-slate-500 disabled:opacity-50">{cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}</button>
            </form>
          )}

          {step === 3 && (
            <form onSubmit={(e) => { e.preventDefault(); register(); }} className="space-y-3">
              <h1 className="text-lg font-semibold text-slate-900">Create a password</h1>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (8+ characters)" autoComplete="new-password" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" required />
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm password" autoComplete="new-password" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" required />
              {error && <p className="text-xs text-red-600">{error}</p>}
              <button type="submit" disabled={busy} className="w-full bg-slate-900 text-white text-sm font-medium px-4 py-2.5 rounded-md disabled:opacity-50">{busy ? "Creating…" : "Create account"}</button>
            </form>
          )}
        </div>
        <p className="text-center text-sm text-slate-500 mt-4">Already have an account? <Link href="/login" className="text-slate-900 font-medium">Sign in</Link></p>
      </div>
    </div>
  );
}

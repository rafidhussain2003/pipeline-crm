"use client";

// Phase 13 — production password reset: email → 6-digit code → new password →
// done. The code + reset both hit the rate-limited /api/auth endpoints.
import { useState } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function requestCode() {
    setError(""); setBusy(true);
    const res = await fetch("/api/auth/forgot-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
    setBusy(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); return setError(typeof d.error === "string" ? d.error : "Please try again."); }
    setStep(2);
  }
  async function reset() {
    setError("");
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (password !== confirm) return setError("Passwords don't match.");
    setBusy(true);
    const res = await fetch("/api/auth/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, code, newPassword: password }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(typeof data.error === "string" ? data.error : "Could not reset your password.");
    setStep(3);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6"><div className="text-2xl font-bold text-slate-900">Ziplod</div></div>
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
          {step === 1 && (
            <form onSubmit={(e) => { e.preventDefault(); requestCode(); }} className="space-y-3">
              <h1 className="text-lg font-semibold text-slate-900">Reset your password</h1>
              <p className="text-sm text-slate-500">Enter your email and we&apos;ll send a reset code.</p>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" required />
              {error && <p className="text-xs text-red-600">{error}</p>}
              <button type="submit" disabled={busy} className="w-full bg-slate-900 text-white text-sm font-medium px-4 py-2.5 rounded-md disabled:opacity-50">{busy ? "Sending…" : "Send reset code"}</button>
            </form>
          )}
          {step === 2 && (
            <form onSubmit={(e) => { e.preventDefault(); reset(); }} className="space-y-3">
              <h1 className="text-lg font-semibold text-slate-900">Enter code & new password</h1>
              <p className="text-sm text-slate-500">If an account exists for {email}, a code is on its way (expires in 10 min).</p>
              <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" inputMode="numeric" className="w-full rounded-md border border-slate-300 px-3 py-2 text-center text-lg tracking-[6px] font-mono" required />
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password (8+ characters)" autoComplete="new-password" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" required />
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm new password" autoComplete="new-password" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" required />
              {error && <p className="text-xs text-red-600">{error}</p>}
              <button type="submit" disabled={busy} className="w-full bg-slate-900 text-white text-sm font-medium px-4 py-2.5 rounded-md disabled:opacity-50">{busy ? "Resetting…" : "Reset password"}</button>
            </form>
          )}
          {step === 3 && (
            <div className="text-center py-4">
              <div className="text-green-600 text-2xl mb-2">✓</div>
              <h1 className="text-lg font-semibold text-slate-900">Password reset</h1>
              <p className="text-sm text-slate-500 mt-1 mb-4">You can now sign in with your new password.</p>
              <Link href="/login" className="inline-block bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">Go to sign in</Link>
            </div>
          )}
        </div>
        <p className="text-center text-sm text-slate-500 mt-4"><Link href="/login" className="text-slate-900 font-medium">Back to sign in</Link></p>
      </div>
    </div>
  );
}

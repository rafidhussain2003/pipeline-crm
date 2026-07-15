"use client";

// Phase 13 — full-screen gate shown to any user whose password must be changed
// (an invited agent's temporary password). Blocks the entire app until they set
// their own password. Reuses the existing /api/auth/change-password endpoint,
// which clears the must-change flag on success.
import { useState } from "react";

export default function ForcePasswordChange() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (next.length < 8) return setError("Your new password must be at least 8 characters.");
    if (next !== confirm) return setError("Passwords don't match.");
    setBusy(true);
    const res = await fetch("/api/auth/change-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: current, newPassword: next }) });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return setError(typeof data.error === "string" ? data.error : "Could not update your password. Check your temporary password.");
    }
    window.location.href = "/leads";
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm bg-white border border-slate-200 rounded-xl shadow-sm p-6">
        <h1 className="text-lg font-semibold text-slate-900">Create your password</h1>
        <p className="text-sm text-slate-500 mt-1 mb-4">For security, you must replace the temporary password you were given before continuing.</p>
        <form onSubmit={submit} className="space-y-3">
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Temporary password" autoComplete="current-password" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" required />
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="New password (8+ characters)" autoComplete="new-password" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" required />
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm new password" autoComplete="new-password" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" required />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button type="submit" disabled={busy} className="w-full bg-slate-900 text-white text-sm font-medium px-4 py-2.5 rounded-md disabled:opacity-50">{busy ? "Saving…" : "Set password & continue"}</button>
        </form>
      </div>
    </div>
  );
}

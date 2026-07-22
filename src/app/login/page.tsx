"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Footer } from "@/components/Footer";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  // Two-step device verification: when the server answers { otpRequired }
  // the form switches to the code step. Email/password are kept in state and
  // re-sent together with the code.
  const [otpStep, setOtpStep] = useState(false);
  const [otp, setOtp] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, rememberMe, ...(otpStep && otp ? { otp } : {}) }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (data.otpRequired && res.ok) {
      // Password accepted, device unknown — the code is on its way.
      setOtpStep(true);
      setNotice(data.message || "Enter the verification code we emailed you.");
      return;
    }
    if (!res.ok) {
      if (data.otpRequired) setOtpStep(true);
      setError(data.error || "Something went wrong");
      return;
    }
    router.push(data.role === "super_admin" ? "/super-admin" : "/leads");
    router.refresh();
  }

  // Re-runs step 1 without a code, which re-triggers the email (the server
  // enforces its own resend cooldown).
  async function resendCode() {
    setOtp("");
    setError("");
    setNotice("");
    setSubmitting(true);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, rememberMe }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (data.otpRequired && res.ok) setNotice("A new code is on its way.");
    else setError(data.error || "Could not resend the code.");
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            {/* Ziplod product branding (same mark as the marketing pages and
                the in-app sidebar). */}
            <div className="flex items-center justify-center gap-2 text-2xl font-bold text-slate-900 tracking-tight">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-slate-900 text-white text-sm shrink-0">Z</span>
              Ziplod
            </div>
            <p className="text-sm text-slate-500 mt-1">Sign in to your account</p>
          </div>
          <form onSubmit={submit} className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {!otpStep && (
              <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="rounded border-slate-300"
                />
                Remember me for 30 days
              </label>
            )}
            {otpStep && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Verification Code</label>
                <input
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="6-digit code"
                  required
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {notice && <p className="text-xs text-slate-500 mt-1.5">{notice}</p>}
                <button
                  type="button"
                  onClick={resendCode}
                  disabled={submitting}
                  className="text-xs text-blue-600 hover:text-blue-800 mt-1.5 disabled:opacity-40"
                >
                  Resend code
                </button>
              </div>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-slate-900 text-white text-sm font-medium py-2.5 rounded-md disabled:opacity-40"
            >
              {submitting ? "Signing in…" : otpStep ? "Verify & Sign In" : "Sign In"}
            </button>
          </form>
          <p className="text-center text-sm mt-3">
            <Link href="/forgot-password" className="text-slate-500 hover:text-slate-700">
              Forgot password?
            </Link>
          </p>
          <p className="text-center text-sm text-slate-500 mt-2">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="text-blue-600 font-medium">
              Sign up
            </Link>
          </p>
        </div>
      </div>
      <Footer />
    </div>
  );
}

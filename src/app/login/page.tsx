"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Footer } from "@/components/Footer";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(data.error || "Something went wrong");
      return;
    }
    router.push(data.role === "super_admin" ? "/super-admin" : "/leads");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="text-2xl font-semibold text-slate-900 tracking-tight">Pipeline</div>
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
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-slate-900 text-white text-sm font-medium py-2.5 rounded-md disabled:opacity-40"
            >
              {submitting ? "Signing in…" : "Sign In"}
            </button>
          </form>
          <p className="text-center text-sm text-slate-500 mt-4">
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

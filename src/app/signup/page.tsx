"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

const PLANS = [
  { id: "starter", name: "Starter", price: 19, blurb: "For small teams getting going" },
  { id: "growth", name: "Growth", price: 15, blurb: "Best value for growing teams" },
  { id: "scale", name: "Scale", price: 12, blurb: "For high-volume operations" },
];

function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [plan, setPlan] = useState(params.get("plan") || "starter");
  const [form, setForm] = useState({ companyName: "", name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, plan }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(data.error?.formErrors?.[0] || data.error || "Something went wrong");
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md text-center bg-white border border-slate-200 rounded-lg p-8">
          <h1 className="text-lg font-semibold text-slate-900 mb-2">You&apos;re almost in</h1>
          <p className="text-sm text-slate-600 mb-6">
            Your account is created and your company is pending activation. We&apos;ll review it shortly — you can
            log in any time to check status.
          </p>
          <button onClick={() => router.push("/login")} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">
            Go to login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-2xl font-semibold text-slate-900 tracking-tight">Pipeline</div>
          <p className="text-sm text-slate-500 mt-1">Create your company account</p>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-5">
          {PLANS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPlan(p.id)}
              className={`text-left rounded-lg border p-3 transition-colors ${
                plan === p.id ? "border-blue-500 ring-1 ring-blue-500 bg-blue-50" : "border-slate-200 bg-white"
              }`}
            >
              <div className="text-xs font-semibold text-slate-900">{p.name}</div>
              <div className="text-sm font-bold text-slate-900">${p.price}<span className="text-xs font-normal text-slate-400">/agent</span></div>
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Company name</label>
            <input
              value={form.companyName}
              onChange={(e) => setForm({ ...form, companyName: e.target.value })}
              required
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Your name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
              minLength={8}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {error && <p className="text-sm text-red-600">{String(error)}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-slate-900 text-white text-sm font-medium py-2.5 rounded-md disabled:opacity-40"
          >
            {submitting ? "Creating account…" : "Create account"}
          </button>
        </form>
        <p className="text-center text-sm text-slate-500 mt-4">
          Already have an account?{" "}
          <Link href="/login" className="text-blue-600 font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}

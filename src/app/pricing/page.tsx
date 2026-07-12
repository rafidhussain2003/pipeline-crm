import Link from "next/link";
import { Footer } from "@/components/Footer";

const PLANS = [
  { id: "starter", name: "Starter", price: 19, blurb: "For small teams getting going", features: ["Up to 15 agents", "Facebook lead ingestion", "3-tier auto-assignment", "Email support"] },
  { id: "growth", name: "Growth", price: 15, blurb: "Best value for growing teams", features: ["Up to 60 agents", "Everything in Starter", "Custom domain", "Priority support"], highlight: true },
  { id: "scale", name: "Scale", price: 12, blurb: "For high-volume operations", features: ["Unlimited agents", "Everything in Growth", "Multiple lead sources", "Dedicated support"] },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-slate-100">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="text-lg font-semibold text-slate-900">Pipeline</Link>
          <Link href="/login" className="text-sm font-medium text-slate-600">Sign in</Link>
        </div>
      </header>

      <section className="max-w-5xl mx-auto px-6 py-16 text-center">
        <h1 className="text-3xl font-semibold text-slate-900 tracking-tight">Simple, per-agent pricing</h1>
        <p className="text-slate-500 mt-3 max-w-xl mx-auto">
          Pay only for active agents. Every plan includes unlimited leads, tiered auto-assignment, and Facebook
          integration.
        </p>
      </section>

      <section className="max-w-5xl mx-auto px-6 pb-24 grid grid-cols-1 md:grid-cols-3 gap-6">
        {PLANS.map((p) => (
          <div
            key={p.id}
            className={`rounded-xl border p-6 flex flex-col ${p.highlight ? "border-blue-500 shadow-lg shadow-blue-100" : "border-slate-200"}`}
          >
            {p.highlight && <div className="text-xs font-semibold text-blue-600 mb-2">MOST POPULAR</div>}
            <div className="text-sm font-medium text-slate-500">{p.name}</div>
            <div className="mt-1 text-3xl font-bold text-slate-900">
              ${p.price}
              <span className="text-sm font-normal text-slate-400">/agent/mo</span>
            </div>
            <div className="text-sm text-slate-500 mt-1">{p.blurb}</div>
            <ul className="mt-6 space-y-2 flex-1">
              {p.features.map((f) => (
                <li key={f} className="text-sm text-slate-700 flex items-center gap-2">
                  <span className="text-emerald-500">✓</span> {f}
                </li>
              ))}
            </ul>
            <Link
              href={`/signup?plan=${p.id}`}
              className={`mt-6 text-center text-sm font-medium py-2.5 rounded-md ${
                p.highlight ? "bg-blue-600 text-white" : "bg-slate-900 text-white"
              }`}
            >
              Get started
            </Link>
          </div>
        ))}
      </section>

      <Footer />
    </div>
  );
}

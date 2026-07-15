import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { MarketingNav } from "@/components/marketing/Nav";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Simple per-agent pricing for Ziplod. Basic $6, Professional $9, Premium $12 per agent per month. 7-day free trial, no credit card required.",
};

const PLANS = [
  { name: "Basic", price: 6, blurb: "Everything to start selling", features: ["Lead management", "Facebook Lead Ads", "Website Forms", "Auto-assignment", "Delivery monitoring"] },
  { name: "Professional", price: 9, blurb: "AI + conversions", highlight: true, features: ["Everything in Basic", "AI assignment + insights", "Meta Conversions API", "Operations dashboard", "Internal mailbox"] },
  { name: "Premium", price: 12, blurb: "For high-volume teams", features: ["Everything in Professional", "Advanced routing (skills / SLA)", "Historical import + resend", "Priority support"] },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingNav />
      <section className="max-w-3xl mx-auto px-6 pt-20 pb-10 text-center">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-slate-900">Simple, per-agent pricing</h1>
        <p className="text-slate-600 text-lg mt-4">Only active agents count toward your bill — suspend an agent and you stop paying for that seat.</p>
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mt-6 text-sm text-slate-600">
          <span className="inline-flex items-center gap-1.5"><Check /> 7-Day Free Trial</span>
          <span className="inline-flex items-center gap-1.5"><Check /> No Credit Card Required</span>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 pb-20">
        <div className="grid gap-6 md:grid-cols-3">
          {PLANS.map((p) => (
            <div key={p.name} className={`rounded-2xl border p-7 flex flex-col ${p.highlight ? "border-slate-900 shadow-lg ring-1 ring-slate-900" : "border-slate-200"}`}>
              {p.highlight && <div className="text-xs font-semibold text-white bg-slate-900 rounded-full px-2.5 py-1 self-start mb-3">Most popular</div>}
              <h2 className="text-xl font-semibold text-slate-900">{p.name}</h2>
              <p className="text-sm text-slate-500 mt-1">{p.blurb}</p>
              <div className="mt-4 flex items-baseline gap-1"><span className="text-5xl font-bold text-slate-900">${p.price}</span><span className="text-sm text-slate-500">/ agent / mo</span></div>
              <Link href="/signup" className={`mt-6 text-center text-sm font-semibold rounded-lg px-4 py-2.5 transition-colors ${p.highlight ? "text-white bg-slate-900 hover:bg-slate-800" : "text-slate-900 bg-slate-100 hover:bg-slate-200"}`}>Start free trial</Link>
              <ul className="mt-6 space-y-2.5">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-slate-700"><Check /> <span>{f}</span></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="text-center text-sm text-slate-500 mt-10">Example: 10 agents on Professional = 10 × $9 = <strong className="text-slate-900">$90/month</strong>.</p>
      </section>

      <Footer />
    </div>
  );
}

function Check() {
  return <svg className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.1 3.1 6.8-6.8a1 1 0 0 1 1.4 0Z" clipRule="evenodd" /></svg>;
}

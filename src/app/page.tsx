import Link from "next/link";
import { Footer } from "@/components/Footer";
import { MarketingNav } from "@/components/marketing/Nav";

const TRUST = ["7-Day Free Trial", "No Credit Card Required", "Setup in Minutes", "Secure Cloud Platform"];

const FEATURES = [
  { title: "AI Assignment", desc: "Leads route themselves — AI picks the best available agent by availability, workload, and fit. No manual assigning." },
  { title: "Meta Lead Ads", desc: "Connect Facebook Lead Ads in a few clicks. New leads flow in the moment someone submits your form." },
  { title: "Website Forms", desc: "Drop one line of code on your site, or build a hosted form. Every submission becomes a routed lead." },
  { title: "Historical Imports", desc: "Backfill past Meta leads with a checkpointed, resumable import — nothing gets duplicated or lost." },
  { title: "Operations Dashboard", desc: "A live view of your whole operation: who's online, what's queued, and where leads are getting stuck." },
  { title: "Delivery Monitoring", desc: "Every lead delivery is logged end-to-end, so you always know a lead arrived — and why one didn't." },
  { title: "Internal Mailbox", desc: "A built-in mailbox for your platform team to handle support and sales conversations in one place." },
];

const STEPS = [
  { n: "1", title: "Connect Meta", desc: "Link your Facebook Lead Ads account in minutes." },
  { n: "2", title: "Import Leads", desc: "Bring in historical leads, or start fresh with live ones." },
  { n: "3", title: "AI Assigns Leads", desc: "Every lead is auto-routed to an available agent instantly." },
  { n: "4", title: "Close More Sales", desc: "Agents work leads faster — no spreadsheets, no delays." },
];

const PLANS = [
  { name: "Basic", price: 6, blurb: "Everything to get selling" },
  { name: "Professional", price: 9, blurb: "AI + conversions", highlight: true },
  { name: "Premium", price: 12, blurb: "For high-volume teams" },
];

const FAQ = [
  { q: "How long is the free trial?", a: "Every company gets a 7-day free trial with full access — no feature is locked during the trial." },
  { q: "Do I need a credit card?", a: "No. You can start your trial and set everything up without entering any payment details." },
  { q: "Can I import historical Meta leads?", a: "Yes. Ziplod can backfill your past Facebook Lead Ads leads with a resumable import that never creates duplicates." },
  { q: "Can I invite my agents?", a: "Yes. Admins invite agents by email; each agent sets their own password on first login. Only active agents count toward your seats." },
  { q: "How are leads assigned?", a: "AI assigns each lead to the best available agent based on presence, workload, and fit — fully automatically, or by rules you choose." },
  { q: "Is Meta integration included?", a: "Yes. Meta Lead Ads (and the Conversions API to send conversions back to Meta) are built in — no third-party connectors." },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingNav />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-slate-50 to-white" aria-hidden="true" />
        <div className="max-w-4xl mx-auto px-6 pt-20 pb-16 sm:pt-28 sm:pb-20 text-center">
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-full px-3 py-1 mb-6 shadow-sm">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" /> Built for lead generation teams
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight text-slate-900 leading-[1.05]">
            AI CRM Built for<br className="hidden sm:block" /> Lead Generation Teams
          </h1>
          <p className="text-slate-600 text-lg sm:text-xl mt-6 max-w-2xl mx-auto leading-relaxed">
            Connect Meta Lead Ads in minutes. AI automatically assigns leads to available agents. No spreadsheets. No manual routing.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-9">
            <Link href="/signup" className="w-full sm:w-auto text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg px-6 py-3 transition-colors">Start Free Trial</Link>
            <Link href="/contact" className="w-full sm:w-auto text-sm font-semibold text-slate-700 bg-white border border-slate-300 hover:border-slate-400 rounded-lg px-6 py-3 transition-colors">Book a Demo</Link>
          </div>
        </div>
      </section>

      {/* Trust bar */}
      <section aria-label="Highlights" className="border-y border-slate-100 bg-slate-50/50">
        <div className="max-w-5xl mx-auto px-6 py-5 grid grid-cols-2 md:grid-cols-4 gap-4">
          {TRUST.map((t) => (
            <div key={t} className="flex items-center gap-2 justify-center text-sm text-slate-700">
              <svg className="w-4 h-4 text-emerald-500 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.1 3.1 6.8-6.8a1 1 0 0 1 1.4 0Z" clipRule="evenodd" /></svg>
              <span className="font-medium">{t}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="max-w-6xl mx-auto px-6 py-20 sm:py-24">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">Everything you need to move fast</h2>
          <p className="text-slate-600 mt-3 text-lg">The core tools a high-volume lead team actually uses — nothing you don&apos;t.</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-slate-200 bg-white p-6 hover:border-slate-300 hover:shadow-sm transition">
              <h3 className="text-base font-semibold text-slate-900">{f.title}</h3>
              <p className="text-sm text-slate-600 mt-2 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="bg-slate-900 text-white">
        <div className="max-w-6xl mx-auto px-6 py-20 sm:py-24">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">How it works</h2>
            <p className="text-slate-300 mt-3 text-lg">From ad to closed sale in four steps.</p>
          </div>
          <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <li key={s.n} className="relative">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-white text-slate-900 font-bold mb-4">{s.n}</div>
                <h3 className="text-lg font-semibold">{s.title}</h3>
                <p className="text-sm text-slate-300 mt-1.5 leading-relaxed">{s.desc}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Pricing preview */}
      <section id="pricing" className="max-w-5xl mx-auto px-6 py-20 sm:py-24">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">Simple, per-agent pricing</h2>
          <p className="text-slate-600 mt-3 text-lg">Only active agents count. 7-day free trial, no credit card required.</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-3">
          {PLANS.map((p) => (
            <div key={p.name} className={`rounded-2xl border p-6 flex flex-col ${p.highlight ? "border-slate-900 shadow-lg" : "border-slate-200"}`}>
              {p.highlight && <div className="text-xs font-semibold text-white bg-slate-900 rounded-full px-2.5 py-1 self-start mb-3">Most popular</div>}
              <h3 className="text-lg font-semibold text-slate-900">{p.name}</h3>
              <div className="mt-2 flex items-baseline gap-1"><span className="text-4xl font-bold text-slate-900">${p.price}</span><span className="text-sm text-slate-500">/ agent / mo</span></div>
              <p className="text-sm text-slate-500 mt-1">{p.blurb}</p>
              <Link href="/signup" className={`mt-6 text-center text-sm font-semibold rounded-lg px-4 py-2.5 transition-colors ${p.highlight ? "text-white bg-slate-900 hover:bg-slate-800" : "text-slate-900 bg-slate-100 hover:bg-slate-200"}`}>Start free trial</Link>
            </div>
          ))}
        </div>
        <p className="text-center mt-6"><Link href="/pricing" className="text-sm font-medium text-slate-600 hover:text-slate-900">Compare plans in detail →</Link></p>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-t border-slate-100 bg-slate-50/50">
        <div className="max-w-3xl mx-auto px-6 py-20 sm:py-24">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 text-center mb-10">Frequently asked questions</h2>
          <div className="divide-y divide-slate-200">
            {FAQ.map((f) => (
              <details key={f.q} className="group py-4">
                <summary className="flex items-center justify-between cursor-pointer list-none text-base font-medium text-slate-900">
                  {f.q}
                  <svg className="w-5 h-5 text-slate-400 transition-transform group-open:rotate-180" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4Z" clipRule="evenodd" /></svg>
                </summary>
                <p className="text-sm text-slate-600 mt-2 leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-4xl mx-auto px-6 py-20 sm:py-24 text-center">
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">Ready to stop routing leads by hand?</h2>
        <p className="text-slate-600 mt-3 text-lg">Start your free trial today — no card, setup in minutes.</p>
        <div className="mt-8"><Link href="/signup" className="inline-flex text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg px-6 py-3 transition-colors">Start Free Trial</Link></div>
      </section>

      <Footer />
    </div>
  );
}

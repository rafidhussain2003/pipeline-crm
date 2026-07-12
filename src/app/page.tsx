import Link from "next/link";
import { Footer } from "@/components/Footer";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-slate-100">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="text-lg font-semibold text-slate-900">Pipeline</div>
          <nav className="flex items-center gap-6">
            <Link href="/pricing" className="text-sm font-medium text-slate-600">Pricing</Link>
            <Link href="/login" className="text-sm font-medium text-slate-600">Sign in</Link>
            <Link href="/signup" className="text-sm font-medium text-white bg-slate-900 rounded-md px-4 py-2">Sign up</Link>
          </nav>
        </div>
      </header>

      <section className="max-w-4xl mx-auto px-6 pt-24 pb-20 text-center">
        <div className="inline-block text-xs font-semibold text-blue-600 bg-blue-50 rounded-full px-3 py-1 mb-6">
          Built for high-volume lead ads
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold text-slate-900 tracking-tight leading-tight">
          Leads land. Agents get assigned.
          <br />No rate limits.
        </h1>
        <p className="text-slate-500 text-lg mt-5 max-w-xl mx-auto">
          A fast, no-nonsense CRM for Facebook lead ads. Connect a page, set your tiers, and watch leads route
          themselves — even at thousands per day.
        </p>
        <div className="flex items-center justify-center gap-3 mt-8">
          <Link href="/signup" className="bg-slate-900 text-white text-sm font-medium px-5 py-3 rounded-md">
            Start free trial
          </Link>
          <Link href="/pricing" className="text-slate-700 text-sm font-medium px-5 py-3 rounded-md border border-slate-200">
            See pricing
          </Link>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 pb-24 grid grid-cols-1 md:grid-cols-3 gap-8">
        <div>
          <div className="text-blue-600 font-semibold text-sm mb-2">Instant ingestion</div>
          <p className="text-sm text-slate-600">
            Connect a Facebook page access token once. New leads arrive the moment someone submits a form — no
            polling, no delay.
          </p>
        </div>
        <div>
          <div className="text-blue-600 font-semibold text-sm mb-2">Tiered auto-assignment</div>
          <p className="text-sm text-slate-600">
            Put agents in Tier 1, 2, or 3 and set the ratio. Leads distribute automatically in weighted order — fair,
            fast, and fully logged.
          </p>
        </div>
        <div>
          <div className="text-blue-600 font-semibold text-sm mb-2">Built to scale</div>
          <p className="text-sm text-slate-600">
            A real database and background processing under the hood, so hundreds of agents working at once never
            hit a wall.
          </p>
        </div>
      </section>

      <Footer />
    </div>
  );
}

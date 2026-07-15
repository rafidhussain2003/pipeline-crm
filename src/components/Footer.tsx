import Link from "next/link";

// Shared footer for every public/marketing page. Phase 14: professional layout
// with the registered company address + a full link set. One component so the
// links + company details live in one place.
export function Footer() {
  return (
    <footer className="border-t border-slate-100 bg-white">
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="grid gap-8 sm:grid-cols-2 md:grid-cols-4">
          <div className="sm:col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 text-lg font-bold tracking-tight text-slate-900">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-slate-900 text-white text-xs">Z</span>
              Ziplod
            </div>
            <p className="text-sm text-slate-500 mt-3 max-w-xs">AI CRM built for lead generation teams. Connect Meta Lead Ads and let AI route every lead.</p>
          </div>

          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Product</h3>
            <ul className="space-y-2 text-sm">
              <li><Link href="/pricing" className="text-slate-600 hover:text-slate-900">Pricing</Link></li>
              <li><Link href="/contact" className="text-slate-600 hover:text-slate-900">Contact</Link></li>
              <li><Link href="/login" className="text-slate-600 hover:text-slate-900">Login</Link></li>
              <li><Link href="/signup" className="text-slate-600 hover:text-slate-900">Sign Up</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Legal</h3>
            <ul className="space-y-2 text-sm">
              <li><Link href="/privacy" className="text-slate-600 hover:text-slate-900">Privacy Policy</Link></li>
              <li><Link href="/terms" className="text-slate-600 hover:text-slate-900">Terms &amp; Conditions</Link></li>
              <li><Link href="/data-deletion" className="text-slate-600 hover:text-slate-900">Data Deletion</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Company</h3>
            <address className="not-italic text-sm text-slate-600 leading-relaxed">
              Breetscan CableTV LLC<br />
              1405 Pinckardsville Rd<br />
              Lancaster, VA 22503
            </address>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-slate-400">© {new Date().getFullYear()} Breetscan CableTV LLC. All rights reserved.</p>
          <p className="text-xs text-slate-400">Secure cloud platform · Made for high-volume lead teams</p>
        </div>
      </div>
    </footer>
  );
}

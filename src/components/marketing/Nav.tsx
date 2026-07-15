import Link from "next/link";

// Phase 14 — shared marketing site header. Sticky, responsive (nav links hide
// on the smallest screens, CTAs always visible), and keyboard-accessible.
export function MarketingNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-100 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight text-slate-900" aria-label="Ziplod home">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-slate-900 text-white text-sm">Z</span>
          Ziplod
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2" aria-label="Primary">
          <Link href="/pricing" className="hidden sm:inline-flex text-sm font-medium text-slate-600 hover:text-slate-900 px-3 py-2 rounded-md">Pricing</Link>
          <Link href="/contact" className="hidden sm:inline-flex text-sm font-medium text-slate-600 hover:text-slate-900 px-3 py-2 rounded-md">Contact</Link>
          <Link href="/login" className="text-sm font-medium text-slate-600 hover:text-slate-900 px-3 py-2 rounded-md">Sign in</Link>
          <Link href="/signup" className="text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md px-4 py-2 transition-colors">Start free trial</Link>
        </nav>
      </div>
    </header>
  );
}

import Link from "next/link";

// Shared footer for every public/marketing page (landing, pricing, login,
// signup, and any future marketing page) — kept as one component so the
// link set and copyright line only need to be updated in one place.
export function Footer() {
  return (
    <footer className="border-t border-slate-100 bg-white">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <nav className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm">
          <Link href="/pricing" className="text-slate-600 hover:text-slate-900">
            Pricing
          </Link>
          <Link href="/login" className="text-slate-600 hover:text-slate-900">
            Sign In
          </Link>
          <Link href="/signup" className="text-slate-600 hover:text-slate-900">
            Sign Up
          </Link>
          <Link href="/privacy" className="text-slate-600 hover:text-slate-900">
            Privacy Policy
          </Link>
          <Link href="/terms" className="text-slate-600 hover:text-slate-900">
            Terms &amp; Conditions
          </Link>
          <Link href="/contact" className="text-slate-600 hover:text-slate-900">
            Contact
          </Link>
          <Link href="/data-deletion" className="text-slate-600 hover:text-slate-900">
            Data Deletion
          </Link>
        </nav>
        <p className="text-center text-xs text-slate-400 mt-6">
          © {new Date().getFullYear()} Breetscan Cabletv LLC. All rights reserved.
        </p>
      </div>
    </footer>
  );
}

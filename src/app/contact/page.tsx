import Link from "next/link";
import { Footer } from "@/components/Footer";

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <header className="border-b border-slate-100">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="text-lg font-semibold text-slate-900">
            Pipeline
          </Link>
          <nav className="flex items-center gap-6">
            <Link href="/pricing" className="text-sm font-medium text-slate-600">
              Pricing
            </Link>
            <Link href="/login" className="text-sm font-medium text-slate-600">
              Sign in
            </Link>
            <Link href="/signup" className="text-sm font-medium text-white bg-slate-900 rounded-md px-4 py-2">
              Sign up
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-16 flex-1">
        <h1 className="text-3xl font-semibold text-slate-900 tracking-tight">Contact Us</h1>
        <p className="text-sm text-slate-600 leading-relaxed mt-4 max-w-xl">
          Have a question about billing, privacy, support, or a legal matter? We&apos;re happy to help — reach out
          using the details below and we&apos;ll get back to you as soon as we can.
        </p>

        <div className="mt-10 bg-slate-50 border border-slate-200 rounded-lg p-6 max-w-md">
          <div className="text-sm font-semibold text-slate-900">Breetscan Cabletv LLC</div>
          <div className="text-sm text-slate-600 mt-2 leading-relaxed">
            1405 Pinckardsville Rd
            <br />
            Lancaster, VA 22503
            <br />
            United States
          </div>

          <div className="mt-5 pt-5 border-t border-slate-200 space-y-2">
            <div className="text-sm">
              <span className="text-slate-500">Email: </span>
              <a href="mailto:support@ziplod.com" className="text-blue-600 font-medium">
                support@ziplod.com
              </a>
            </div>
            <div className="text-sm">
              <span className="text-slate-500">Website: </span>
              <a href="https://ziplod.com" className="text-blue-600 font-medium">
                https://ziplod.com
              </a>
            </div>
          </div>
        </div>

        <p className="text-xs text-slate-400 mt-6 max-w-md">
          For billing questions, please include your company name so we can locate your account faster.
        </p>
      </main>

      <Footer />
    </div>
  );
}

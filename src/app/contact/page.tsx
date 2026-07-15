import type { Metadata } from "next";
import { Footer } from "@/components/Footer";
import { MarketingNav } from "@/components/marketing/Nav";

export const metadata: Metadata = {
  title: "Contact",
  description: "Get in touch with the Ziplod team — support, sales, and business details.",
};

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <MarketingNav />
      <main className="max-w-4xl mx-auto px-6 py-16 flex-1 w-full">
        <h1 className="text-4xl font-bold tracking-tight text-slate-900">Contact us</h1>
        <p className="text-slate-600 leading-relaxed mt-4 max-w-xl text-lg">
          Questions about the product, a demo, billing, or a legal matter? Reach out and we&apos;ll get back to you.
        </p>

        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 p-6">
            <h2 className="text-sm font-semibold text-slate-900">Support</h2>
            <p className="text-sm text-slate-500 mt-1">Help with your account or a technical issue.</p>
            <a href="mailto:support@ziplod.com" className="inline-block text-sm font-medium text-slate-900 mt-3">support@ziplod.com</a>
          </div>
          <div className="rounded-xl border border-slate-200 p-6">
            <h2 className="text-sm font-semibold text-slate-900">Sales</h2>
            <p className="text-sm text-slate-500 mt-1">Pricing, demos, and questions before you sign up.</p>
            <a href="mailto:sales@ziplod.com" className="inline-block text-sm font-medium text-slate-900 mt-3">sales@ziplod.com</a>
          </div>
          <div className="rounded-xl border border-slate-200 p-6">
            <h2 className="text-sm font-semibold text-slate-900">Business hours</h2>
            <p className="text-sm text-slate-600 mt-2 leading-relaxed">Monday – Friday<br />9:00 AM – 6:00 PM ET</p>
            <p className="text-xs text-slate-400 mt-2">We reply to most emails within one business day.</p>
          </div>
          <div className="rounded-xl border border-slate-200 p-6">
            <h2 className="text-sm font-semibold text-slate-900">Mailing address</h2>
            <address className="not-italic text-sm text-slate-600 mt-2 leading-relaxed">
              Breetscan CableTV LLC<br />
              1405 Pinckardsville Rd<br />
              Lancaster, VA 22503<br />
              United States
            </address>
          </div>
        </div>

        <p className="text-xs text-slate-400 mt-8 max-w-md">For billing questions, please include your company name so we can find your account faster.</p>
      </main>
      <Footer />
    </div>
  );
}

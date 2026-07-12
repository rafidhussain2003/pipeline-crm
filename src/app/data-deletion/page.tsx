import Link from "next/link";
import { Footer } from "@/components/Footer";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-slate-900 mb-3">{title}</h2>
      <div className="space-y-3 text-sm text-slate-600 leading-relaxed">{children}</div>
    </section>
  );
}

export default function DataDeletionPage() {
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
        <h1 className="text-3xl font-semibold text-slate-900 tracking-tight">Data Deletion Instructions</h1>
        <p className="text-sm text-slate-400 mt-2">Last updated: July 2026</p>

        <p className="text-sm text-slate-600 leading-relaxed mt-6">
          This page explains how to request deletion of your data from Pipeline CRM, operated by Breetscan Cabletv
          LLC, including data received through the Meta/Facebook integration (Facebook Login and Facebook Lead Ads).
        </p>

        <Section title="1. What Data We Receive Through Facebook">
          <p>
            When a business connects a Facebook Page to Pipeline CRM, we receive and store limited data through
            Meta&apos;s APIs on that business&apos;s behalf: basic Page information, the connected account&apos;s
            name and email (for identifying the connection), and lead details submitted through that Page&apos;s
            Lead Ads forms (name, phone number, email, and any custom fields captured by the form). We do not
            receive or store your personal Facebook profile data, posts, friends list, or any information beyond
            what Meta&apos;s Lead Ads and Page permissions explicitly provide.
          </p>
        </Section>

        <Section title="2. How to Request Deletion">
          <p>You can request deletion of this data in either of the following ways:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong className="text-slate-900">If you are a Pipeline CRM customer</strong> (the business that
              connected the Facebook Page): sign in, go to Lead Sources, and click &quot;Disconnect&quot; on the
              connected account. This immediately stops any further data collection and revokes our access. To
              request deletion of previously collected lead data, email us at the address below.
            </li>
            <li>
              <strong className="text-slate-900">If you are an individual whose data was submitted through a Lead
              Ads form</strong> connected to Pipeline CRM: contact the business that ran the ad directly, or email us
              at the address below and we will identify and delete the relevant records from our systems.
            </li>
          </ul>
          <p>
            You can also revoke Pipeline CRM&apos;s access to your Facebook account at any time from your own
            Facebook settings under Settings &amp; Privacy → Settings → Apps and Websites.
          </p>
        </Section>

        <Section title="3. What Happens When You Request Deletion">
          <p>
            Once we receive and verify a deletion request, we will delete the associated data from our production
            systems within 30 days, except where we are required to retain certain records for legal, accounting, or
            fraud-prevention purposes, in which case that data is retained only as long as necessary and is not used
            for any other purpose.
          </p>
        </Section>

        <Section title="4. Contact Us">
          <p>To request data deletion or ask a question about this process, contact us at:</p>
          <p className="text-slate-900">
            Breetscan Cabletv LLC
            <br />
            1405 Pinckardsville Rd
            <br />
            Lancaster, VA 22503
            <br />
            United States
            <br />
            Email:{" "}
            <a href="mailto:support@ziplod.com" className="text-blue-600">
              support@ziplod.com
            </a>
            <br />
            Website:{" "}
            <a href="https://ziplod.com" className="text-blue-600">
              https://ziplod.com
            </a>
          </p>
          <p>
            See also our{" "}
            <Link href="/privacy" className="text-blue-600">
              Privacy Policy
            </Link>{" "}
            for more on how we collect, use, and protect your information.
          </p>
        </Section>
      </main>

      <Footer />
    </div>
  );
}

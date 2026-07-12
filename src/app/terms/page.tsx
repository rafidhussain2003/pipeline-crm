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

export default function TermsPage() {
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
        <h1 className="text-3xl font-semibold text-slate-900 tracking-tight">Terms &amp; Conditions</h1>
        <p className="text-sm text-slate-400 mt-2">Last updated: July 2026</p>

        <p className="text-sm text-slate-600 leading-relaxed mt-6">
          These Terms &amp; Conditions (&quot;Terms&quot;) govern your access to and use of Pipeline CRM (the
          &quot;Service&quot;), provided by Breetscan Cabletv LLC (&quot;Company,&quot; &quot;we,&quot;
          &quot;us,&quot; or &quot;our&quot;), located at 1405 Pinckardsville Rd, Lancaster, VA 22503, United States.
          By accessing or using the Service at{" "}
          <a href="https://ziplod.com" className="text-blue-600">
            https://ziplod.com
          </a>
          , you agree to be bound by these Terms.
        </p>

        <Section title="1. Acceptance of Terms">
          <p>
            By creating an account, accessing, or using the Service, you agree to these Terms and our{" "}
            <Link href="/privacy" className="text-blue-600">
              Privacy Policy
            </Link>
            . If you are entering into these Terms on behalf of a company or other legal entity, you represent that
            you have the authority to bind that entity, in which case &quot;you&quot; refers to that entity.
          </p>
        </Section>

        <Section title="2. Eligibility">
          <p>
            You must be at least 18 years old and capable of forming a legally binding contract to use the Service.
            By using the Service, you represent that you meet these requirements.
          </p>
        </Section>

        <Section title="3. User Accounts">
          <p>
            You are responsible for maintaining the confidentiality of your account credentials and for all activity
            that occurs under your account. You agree to notify us promptly of any unauthorized use of your account.
            We are not liable for any loss arising from your failure to safeguard your credentials.
          </p>
        </Section>

        <Section title="4. Free Trial">
          <p>
            We may offer a free trial period for new accounts. At the end of the trial period, continued use of the
            Service requires an active paid subscription. We reserve the right to modify or discontinue the free
            trial offer, or any feature of it, at any time without notice.
          </p>
        </Section>

        <Section title="5. Paid Subscriptions">
          <p>
            Access to certain features of the Service requires a paid subscription, billed on a recurring basis
            based on the plan and number of active agent seats. Subscription fees are processed by our third-party
            payment processor, Stripe. You agree to provide accurate and current billing information.
          </p>
        </Section>

        <Section title="6. Automatic Renewals">
          <p>
            Subscriptions automatically renew at the end of each billing cycle unless cancelled prior to the renewal
            date. You authorize us to charge your payment method on file for each renewal period until you cancel.
          </p>
        </Section>

        <Section title="7. Cancellation Policy">
          <p>
            You may cancel your subscription at any time through your account settings or by contacting us.
            Cancellation will take effect at the end of the current billing period, and you will retain access to
            the Service until that date. We do not provide refunds for partial billing periods except where required
            by law.
          </p>
        </Section>

        <Section title="8. Acceptable Use">
          <p>
            You agree to use the Service only for lawful purposes and in accordance with these Terms. You are
            responsible for ensuring that any data you upload, submit, or process through the Service — including
            Customer Data and Lead Information — complies with applicable law, including data protection and
            telemarketing/anti-spam laws (such as the TCPA and CAN-SPAM Act where applicable).
          </p>
        </Section>

        <Section title="9. Prohibited Activities">
          <p>You agree not to:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Use the Service to transmit unsolicited communications in violation of applicable law</li>
            <li>Attempt to gain unauthorized access to the Service, other accounts, or our systems</li>
            <li>Reverse-engineer, decompile, or attempt to extract the source code of the Service</li>
            <li>Interfere with or disrupt the integrity or performance of the Service</li>
            <li>Use the Service to store or transmit unlawful, infringing, or harmful content</li>
            <li>Resell or sublicense the Service without our prior written consent</li>
            <li>Use automated means to access the Service beyond what we provide</li>
          </ul>
        </Section>

        <Section title="10. Customer Responsibilities">
          <p>
            You are solely responsible for the accuracy, legality, and appropriateness of any data you input into or
            connect to the Service, including lead data obtained from third-party sources such as Meta/Facebook Lead
            Ads or Google Lead Forms. You represent that you have all necessary rights, consents, and permissions to
            collect, process, and store such data, and to route it to your agents through the Service.
          </p>
        </Section>

        <Section title="11. Intellectual Property">
          <p>
            The Service, including its software, design, features, and all related intellectual property, is owned
            by the Company or its licensors and is protected by applicable intellectual property laws. These Terms
            do not grant you any ownership rights in the Service — only a limited, non-exclusive, non-transferable
            license to use it in accordance with these Terms.
          </p>
        </Section>

        <Section title="12. Data Ownership">
          <p>
            As between you and the Company, you retain all ownership rights to the Customer Data and Lead
            Information you submit to or process through the Service. We claim no ownership over your data. You
            grant us a limited license to host, process, and transmit that data solely as necessary to provide the
            Service to you.
          </p>
        </Section>

        <Section title="13. Service Availability">
          <p>
            We strive to maintain high availability of the Service but do not guarantee uninterrupted or error-free
            operation. The Service may be temporarily unavailable due to maintenance, updates, or circumstances
            beyond our reasonable control. We are not liable for any loss resulting from Service downtime.
          </p>
        </Section>

        <Section title="14. Limitation of Liability">
          <p>
            To the maximum extent permitted by law, the Company shall not be liable for any indirect, incidental,
            special, consequential, or punitive damages, or any loss of profits, revenue, data, or business
            opportunities, arising out of or related to your use of the Service. Our total aggregate liability for
            any claim arising from these Terms or the Service shall not exceed the amount you paid us in the twelve
            (12) months preceding the claim.
          </p>
        </Section>

        <Section title="15. Termination">
          <p>
            We may suspend or terminate your access to the Service if you violate these Terms, fail to pay
            applicable fees, or for any other reason at our reasonable discretion, with or without notice. Upon
            termination, your right to use the Service will immediately cease. Sections of these Terms that by their
            nature should survive termination (including intellectual property, limitation of liability, and
            governing law) will survive.
          </p>
        </Section>

        <Section title="16. Governing Law">
          <p>
            These Terms are governed by and construed in accordance with the laws of the Commonwealth of Virginia,
            United States, without regard to its conflict of law principles. Any disputes arising under these Terms
            shall be subject to the exclusive jurisdiction of the state and federal courts located in Virginia.
          </p>
        </Section>

        <Section title="17. Changes to These Terms">
          <p>
            We may update these Terms from time to time. We will indicate the date of the most recent revision
            above. Continued use of the Service after changes take effect constitutes your acceptance of the revised
            Terms.
          </p>
        </Section>

        <Section title="18. Contact Details">
          <p>Questions about these Terms should be directed to:</p>
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
        </Section>
      </main>

      <Footer />
    </div>
  );
}

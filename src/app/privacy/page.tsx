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

export default function PrivacyPolicyPage() {
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
        <h1 className="text-3xl font-semibold text-slate-900 tracking-tight">Privacy Policy</h1>
        <p className="text-sm text-slate-400 mt-2">Last updated: July 2026</p>

        <p className="text-sm text-slate-600 leading-relaxed mt-6">
          Breetscan Cabletv LLC (&quot;Company,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) operates
          Pipeline CRM (the &quot;Service&quot;), a customer relationship management platform for lead capture,
          distribution, and pipeline management, available at{" "}
          <a href="https://ziplod.com" className="text-blue-600">
            https://ziplod.com
          </a>
          . This Privacy Policy explains how we collect, use, disclose, and safeguard information when you use the
          Service. By using the Service, you agree to the terms of this Privacy Policy.
        </p>

        <Section title="1. Information We Collect">
          <p>
            <strong className="text-slate-900">Account Information.</strong> When you or your organization creates
            an account, we collect information such as your name, company name, email address, phone number,
            password (stored as a secure one-way hash, never in plain text), billing information, and any other
            details you provide during signup or while using the Service.
          </p>
          <p>
            <strong className="text-slate-900">Customer Data.</strong> Businesses using Pipeline CRM (&quot;our
            customers&quot;) may upload, submit, or connect data about their own end customers and prospects
            (&quot;Customer Data&quot;) in the course of using the Service. We process this data on our
            customers&apos; behalf; our customers act as the data controller for Customer Data, and we act as a
            data processor / service provider.
          </p>
          <p>
            <strong className="text-slate-900">Lead Information.</strong> When a customer connects a lead source
            (such as Meta/Facebook Lead Ads, Google Lead Forms, a website form, or another integration), we receive
            and store the lead details submitted through that source — which may include a lead&apos;s name, phone
            number, email address, and any custom fields captured by the connected form. This information is only
            accessible to the connecting business and its authorized users.
          </p>
          <p>
            <strong className="text-slate-900">Usage and Device Information.</strong> We automatically collect
            certain technical information when you use the Service, including IP address, browser type, device
            information, pages visited, and timestamps, to help us operate, secure, and improve the Service.
          </p>
        </Section>

        <Section title="2. Cookies">
          <p>
            We use cookies and similar technologies to keep you signed in, remember preferences, and understand how
            the Service is used. Session cookies used for authentication are essential to the Service&apos;s
            operation. You can control cookies through your browser settings, though disabling essential cookies may
            prevent you from using certain features of the Service.
          </p>
        </Section>

        <Section title="3. Analytics">
          <p>
            We may use analytics tools to understand aggregate usage patterns and improve the Service&apos;s
            performance and reliability. Analytics data is used internally and is not sold to third parties.
          </p>
        </Section>

        <Section title="4. How We Use Information">
          <p>We use the information we collect to:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Provide, operate, and maintain the Service</li>
            <li>Authenticate users and secure accounts</li>
            <li>Route and assign leads according to each customer&apos;s configuration</li>
            <li>Process payments and manage subscriptions</li>
            <li>Communicate with you about your account, billing, and Service updates</li>
            <li>Detect, prevent, and address fraud, abuse, or technical issues</li>
            <li>Comply with legal obligations</li>
          </ul>
        </Section>

        <Section title="5. Security">
          <p>
            We implement industry-standard technical and organizational safeguards to protect information against
            unauthorized access, alteration, disclosure, or destruction. Sensitive data — including passwords and
            third-party access tokens (such as Facebook Page access tokens) — is encrypted at rest. Access to
            Customer Data and Lead Information is restricted to authorized users within each customer&apos;s own
            account. No method of transmission or storage is 100% secure, and we cannot guarantee absolute security.
          </p>
        </Section>

        <Section title="6. Data Retention">
          <p>
            We retain account information and Customer Data for as long as an account remains active, or as needed
            to provide the Service. If an account is closed, we may retain certain data as required by law, for
            legitimate business purposes (such as fraud prevention or dispute resolution), or as otherwise permitted
            by this Policy, after which it is deleted or anonymized.
          </p>
        </Section>

        <Section title="7. Third-Party Integrations">
          <p>
            Pipeline CRM allows customers to connect third-party services to automate lead capture and other
            workflows. When you connect a third-party integration, you authorize us to access and process data from
            that service in accordance with this Policy and the third party&apos;s own terms.
          </p>
          <p>
            <strong className="text-slate-900">Meta / Facebook Integration.</strong> When a customer connects a
            Facebook Page or Meta Business account, we access limited information through Meta&apos;s APIs —
            including Page details, Lead Ads form submissions, and the permissions explicitly granted during
            authorization (such as pages_show_list, leads_retrieval, and business_management). This access is used
            solely to retrieve leads submitted through the connected Page&apos;s Lead Ads forms and to maintain the
            connection (e.g., webhook subscriptions). We do not use Meta user data for advertising purposes, and our
            use of information received from Meta APIs is subject to Meta&apos;s Platform Terms and Developer
            Policies.
          </p>
          <p>
            <strong className="text-slate-900">Google Integrations.</strong> Where supported, connecting
            Google-based lead sources (such as Google Lead Forms) operates on a similar basis — we process only the
            lead-form submission data made available through the connection, solely to deliver leads into the
            Service.
          </p>
          <p>
            <strong className="text-slate-900">Stripe Payment Information.</strong> Subscription payments are
            processed by Stripe, Inc. We do not store full credit card numbers on our servers. Stripe collects and
            processes payment card information directly, subject to Stripe&apos;s own privacy policy and PCI-DSS
            compliance obligations. We retain only limited billing metadata (such as subscription status and billing
            dates) necessary to manage your subscription.
          </p>
        </Section>

        <Section title="8. Data Sharing and Disclosure">
          <p>We do not sell personal information. We may share information:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>With service providers who perform services on our behalf (e.g., hosting, payment processing) under confidentiality obligations</li>
            <li>To comply with a legal obligation, court order, or governmental request</li>
            <li>To protect the rights, property, or safety of the Company, our customers, or others</li>
            <li>In connection with a merger, acquisition, or sale of assets, subject to standard confidentiality protections</li>
          </ul>
        </Section>

        <Section title="9. Your Rights">
          <p>
            <strong className="text-slate-900">GDPR (European Users).</strong> If you are located in the European
            Economic Area, UK, or Switzerland, you have certain rights under the General Data Protection Regulation
            (GDPR), including the right to access, correct, delete, or restrict processing of your personal data,
            the right to data portability, and the right to object to certain processing. Where we act as a data
            processor on behalf of our customers, requests regarding Customer Data or Lead Information should
            generally be directed to the relevant customer (data controller); we will assist as required by
            applicable law.
          </p>
          <p>
            <strong className="text-slate-900">CCPA (California Residents).</strong> If you are a California
            resident, you have rights under the California Consumer Privacy Act (CCPA), including the right to know
            what personal information we collect, the right to request deletion of your personal information, and
            the right to non-discrimination for exercising your privacy rights. We do not sell personal information
            as defined under the CCPA.
          </p>
          <p>
            To exercise any of these rights, contact us using the information below. We may need to verify your
            identity before fulfilling certain requests.
          </p>
        </Section>

        <Section title="10. Children's Privacy">
          <p>
            The Service is not directed to individuals under the age of 18, and we do not knowingly collect personal
            information from children.
          </p>
        </Section>

        <Section title="11. International Data Transfers">
          <p>
            Information we collect may be transferred to, stored, and processed in the United States or other
            countries where our service providers operate. By using the Service, you consent to such transfers.
          </p>
        </Section>

        <Section title="12. Changes to This Policy">
          <p>
            We may update this Privacy Policy from time to time. Material changes will be reflected by updating the
            &quot;Last updated&quot; date above. Continued use of the Service after changes take effect constitutes
            acceptance of the revised Policy.
          </p>
        </Section>

        <Section title="13. Contact Us">
          <p>If you have questions about this Privacy Policy or how we handle your information, contact us at:</p>
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

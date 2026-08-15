// HR — Offer Letter + Employment & Data Protection Agreement generator.
//
// Renders a complete, print-perfect A4 document as self-contained HTML:
// company letterhead on every page, the offer letter, then the agreement the
// employee signs before joining (a call-center-specific data-protection
// agreement whose purpose is to place responsibility for customer PII and
// company data squarely on the employee), ending with signature blocks.
// "Download PDF" is the browser's native print-to-PDF of this page — no PDF
// library, real logo/colours/highlight preserved, and it prints directly too.
//
// Company identity (name, tagline, GST, phone, email, address) is the
// tenant's letterhead. Today it is the Brivent letterhead the owner supplied;
// it lives in ONE constant so a per-company letterhead setting can replace it
// later without touching the template.

export type OfferLetterInput = {
  // Candidate
  candidateName: string;
  candidateAddress?: string;
  candidatePhone?: string;
  candidateEmail?: string;
  // Offer
  designation: string;
  department?: string;
  employmentType?: string; // Full-time / Part-time / Contract / Probation
  monthlySalary: string; // pre-formatted number, e.g. "25,000"
  salaryCurrency?: string; // default INR
  incentiveNote?: string; // e.g. "plus performance incentives as per company policy"
  joiningDate: string; // yyyy-mm-dd
  workLocation?: string;
  workingHours?: string; // e.g. "8:00 PM – 5:00 AM IST (US shift), Monday to Friday"
  probationMonths?: number; // default 3
  noticeDays?: number; // default 30
  reportingTo?: string;
  // Meta
  letterDate: string; // yyyy-mm-dd
  referenceNo?: string;
  hrSignatoryName?: string;
  hrSignatoryTitle?: string;
};

// The letterhead. Sourced from the owner-supplied Brivent Solutions letterhead.
export const COMPANY_LETTERHEAD = {
  name: "BRIVENT SOLUTIONS OPC PVT LTD",
  shortName: "Brivent Solutions OPC Pvt Ltd",
  tagline: "Always on time",
  gst: "27AAOCB5441K1ZB",
  phone: "+91 9906306408",
  email: "enquiry@briventasolutions.com",
  address:
    "Office No. 1004, 10th Floor, Plot. X-5/3, Technocity, next to Bharat Petroleum Petrol Pump, Above ICICI Bank, Mahape, Navi Mumbai, Maharashtra - 400710",
  city: "Navi Mumbai",
} as const;

const esc = (s: string | undefined | null) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return esc(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
}

// Multi-line address → <br>-joined, escaped.
const multiline = (s: string | undefined) =>
  esc(s || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join("<br>");

export function buildOfferLetterHtml(input: OfferLetterInput): string {
  const C = COMPANY_LETTERHEAD;
  const currency = input.salaryCurrency?.trim() || "INR";
  const probation = input.probationMonths ?? 3;
  const notice = input.noticeDays ?? 30;
  const employmentType = input.employmentType?.trim() || "Full-time";
  const workingHours = input.workingHours?.trim() || "as per the shift schedule assigned by the Company (international/US-hours process)";
  const workLocation = input.workLocation?.trim() || `${C.shortName}, ${C.city}`;
  const hrName = input.hrSignatoryName?.trim() || "Authorised Signatory";
  const hrTitle = input.hrSignatoryTitle?.trim() || "Human Resources";
  const ref = input.referenceNo?.trim();
  const name = input.candidateName.trim();

  // ── Letterhead (repeats on every printed page via position:fixed) ────────
  const letterhead = `
  <header class="lh">
    <div class="lh-top">
      <div class="lh-mark" aria-hidden="true">
        <svg viewBox="0 0 64 64" width="52" height="52">
          <path d="M8 4h26a14 14 0 0 1 0 28H8z" fill="#111"/>
          <path d="M8 32h30a14 14 0 0 1 0 28H8z" fill="#111"/>
          <path d="M8 4l48 30-48 30z" fill="#c9b79c" opacity=".92"/>
        </svg>
      </div>
      <div class="lh-name">
        <div class="lh-company">${esc(C.name)}</div>
        <div class="lh-rule"></div>
        <div class="lh-tag"><em>Always</em> <b>on time</b></div>
      </div>
    </div>
    <div class="lh-meta">
      <span class="lh-gst">GST No: ${esc(C.gst)}</span>
      <span class="lh-sep"></span>
      <span>&#9742;&nbsp; ${esc(C.phone)}</span>
      <span class="lh-sep"></span>
      <span>&#9993;&nbsp; ${esc(C.email)}</span>
    </div>
  </header>`;

  const footer = `
  <footer class="lf">
    <b>Office address :</b> ${esc(C.address)}
  </footer>`;

  // ── Offer letter ─────────────────────────────────────────────────────────
  const offer = `
  <section class="doc">
    <div class="meta-row">
      <div>${ref ? `<b>Ref:</b> ${esc(ref)}` : ""}</div>
      <div><b>Date:</b> ${fmtDate(input.letterDate)}</div>
    </div>

    <p class="to">
      <b>To,</b><br>
      <b>${esc(name)}</b><br>
      ${input.candidateAddress ? `${multiline(input.candidateAddress)}<br>` : ""}
      ${input.candidatePhone ? `Phone: ${esc(input.candidatePhone)}<br>` : ""}
      ${input.candidateEmail ? `Email: ${esc(input.candidateEmail)}` : ""}
    </p>

    <h1 class="title">OFFER OF EMPLOYMENT</h1>
    <p class="subject"><b>Subject:</b> Offer for the position of <b>${esc(input.designation)}</b></p>

    <p>Dear ${esc(name)},</p>

    <p>
      Further to your interview and subsequent discussions with us, we are pleased to offer you employment with
      <b>${esc(C.shortName)}</b> (hereinafter “the Company”) on the following terms and conditions:
    </p>

    <table class="terms">
      <tr><th>Position</th><td>${esc(input.designation)}${input.department ? ` — ${esc(input.department)}` : ""}</td></tr>
      <tr><th>Nature of employment</th><td>${esc(employmentType)}</td></tr>
      <tr><th>Date of joining</th><td>${fmtDate(input.joiningDate)}</td></tr>
      <tr><th>Place of work</th><td>${esc(workLocation)}</td></tr>
      <tr><th>Working hours</th><td>${esc(workingHours)}</td></tr>
      <tr><th>Monthly salary</th><td><b>${esc(currency)} ${esc(input.monthlySalary)}</b> per month (gross)${input.incentiveNote ? `, ${esc(input.incentiveNote)}` : ""}</td></tr>
      ${input.reportingTo ? `<tr><th>Reporting to</th><td>${esc(input.reportingTo)}</td></tr>` : ""}
      <tr><th>Probation</th><td>${probation} month${probation === 1 ? "" : "s"} from the date of joining, extendable at the Company’s discretion</td></tr>
      <tr><th>Notice period</th><td>${notice} days (either side) after confirmation; during probation, employment may be ended by either party with 7 days’ notice</td></tr>
    </table>

    <p>
      This offer is subject to (a) satisfactory verification of the documents you submit (identity, address, educational
      and prior-employment records) and (b) your acceptance of the <b>Employment &amp; Data Protection Agreement</b>
      annexed to this letter, which forms an integral part of your terms of employment. Salary is payable monthly in
      arrears, subject to statutory deductions, and is confidential between you and the Company.
    </p>
    <p>
      Your employment is governed by the Company’s policies, rules and code of conduct as amended from time to time.
      Please sign and return the duplicate copy of this letter together with the annexed Agreement, as your acceptance,
      on or before your date of joining.
    </p>
    <p>We welcome you to ${esc(C.shortName)} and look forward to a long and successful association.</p>

    <div class="sig-row">
      <div class="sig">
        <div class="sig-line"></div>
        <div><b>For ${esc(C.shortName)}</b></div>
        <div>${esc(hrName)}<br><span class="muted">${esc(hrTitle)}</span></div>
      </div>
      <div class="sig">
        <div class="sig-line"></div>
        <div><b>Accepted by</b></div>
        <div>${esc(name)}<br><span class="muted">Signature &amp; date</span></div>
      </div>
    </div>
  </section>`;

  // ── Employment & Data Protection Agreement ───────────────────────────────
  const agreement = `
  <section class="doc page-break">
    <h1 class="title">EMPLOYMENT &amp; DATA PROTECTION AGREEMENT</h1>
    <p class="center muted">(Annexure to the Offer of Employment dated ${fmtDate(input.letterDate)})</p>

    <p>
      This Agreement is made on <b>${fmtDate(input.letterDate)}</b> between <b>${esc(C.shortName)}</b>, having its office at
      ${esc(C.address)} (“the Company”), and <b>${esc(name)}</b>${input.candidateAddress ? `, residing at ${esc(input.candidateAddress.replace(/\r?\n/g, ", "))}` : ""}
      (“the Employee”). The Employee is being engaged as <b>${esc(input.designation)}</b> with effect from <b>${fmtDate(input.joiningDate)}</b>.
    </p>

    <h2>1. Nature of the business</h2>
    <p>
      The Company operates an international business process outsourcing (BPO) / call-centre operation. On behalf of
      its clients, the Employee will contact prospective customers, present and sell the clients’ products and services
      (including television, internet, telecommunications and related products), and process orders. In the course of
      this work the Employee will receive, hear or handle customers’ personal and financial information.
    </p>

    <h2>2. Customer personal &amp; financial information — the Employee’s duty</h2>
    <p>
      2.1 &nbsp;“Customer Information” means any information relating to a customer or prospective customer, including
      name, address, telephone number, email, date of birth, government identification or social security numbers,
      payment-card numbers, bank details, account credentials, and any order or verification details.
    </p>
    <p>
      2.2 &nbsp;Customer Information may be used <b>solely</b> for the purpose of verifying and placing the customer’s
      order with the client, at the time of the call, in accordance with the client’s procedures.
    </p>
    <p>
      2.3 &nbsp;The Employee may note Customer Information only transiently (for example on a notepad) while verifying
      it, and <b>must delete and destroy every copy of it — written, typed, saved, photographed or otherwise —
      immediately after the order has been placed and the customer’s service has been activated.</b> No Customer
      Information may be retained, stored, saved, copied, photographed, forwarded, transmitted or taken out of the
      Company’s premises or systems in any form, at any time, for any reason.
    </p>
    <p>
      2.4 &nbsp;<b>Deletion is the Employee’s personal responsibility.</b> The Company provides the leads and the
      opportunity to place orders; the safekeeping and immediate destruction of Customer Information handled by the
      Employee is the Employee’s own obligation, and the Employee confirms they alone control what they note, save
      or retain.
    </p>
    <p>
      2.5 &nbsp;Any misuse of Customer Information by the Employee — including but not limited to fraud, unauthorised
      transactions, identity theft, sharing or selling of information, or any use outside the client’s order process —
      is a criminal act committed by the Employee in their individual capacity, wholly outside the scope of their
      employment and against the express instructions of the Company. <b>The Employee shall be solely and personally
      liable</b>, civilly and criminally, for any such act and for all loss, claims, penalties and legal costs arising
      from it, and shall indemnify and hold the Company harmless in full. The Company shall cooperate with the
      authorities and the affected parties in any such matter.
    </p>

    <h2>3. Company data, leads and confidentiality</h2>
    <p>
      3.1 &nbsp;“Company Data” means all leads (including any customer’s name, telephone number, email or other
      details), lead lists, client information, sales records, scripts, pricing, systems access, reports, and any
      other business information of the Company or its clients, in any form.
    </p>
    <p>
      3.2 &nbsp;Company Data is the exclusive property of the Company. The Employee shall use it only for the
      Company’s work, on the Company’s systems, and shall keep it strictly confidential during and after employment.
    </p>

    <div class="alert">
      <div class="alert-title">&#9888; &nbsp;3.3 &nbsp;DATA THEFT — ZERO TOLERANCE</div>
      <p>
        The Employee shall <b>NOT</b>, under any circumstances: transfer, send, forward, share, copy, upload, message,
        email, photograph, screenshot, write down for removal, or otherwise take <b>ANY Company Data outside the
        Company — not even a single lead</b> (a customer’s name, number or email included) — whether to a personal
        device, personal email, cloud storage, messaging application, social-media account, another person, or any
        third party.
      </p>
      <p>
        The Employee shall <b>NOT</b> use personal Instagram, Facebook, WhatsApp, Telegram or any social-media or
        messaging service, nor any personal mobile phone or camera, on the Company’s computers, network or premises
        in relation to Company Data, and shall <b>NOT</b> take pictures, screenshots or recordings of any screen,
        document or data belonging to the Company or its clients.
      </p>
      <p><b>If the Employee is found doing, or attempting to do, any of the above, the following shall apply immediately:</b></p>
      <ol>
        <li><b>Immediate termination</b> of employment without notice.</li>
        <li><b>Forfeiture</b> of all salary, incentives, commissions and any other amounts then due or accrued to the
            Employee, which shall stand forfeited to the Company as liquidated damages.</li>
        <li>A <b>fine of INR 50,000 (Rupees Fifty Thousand) up to INR 1,00,000 (Rupees One Lakh)</b>, as determined by
            the Company according to the gravity of the breach, payable by the Employee to the Company on demand.</li>
        <li>A <b>police complaint / FIR</b> and such civil and criminal legal action as the Company deems fit,
            including under the Information Technology Act, 2000 and the Indian Penal Code / Bharatiya Nyaya Sanhita.</li>
      </ol>
      <p class="alert-foot">
        The Employee acknowledges that these consequences are reasonable, proportionate to the harm such theft causes
        the Company and its clients, and are agreed to knowingly and voluntarily.
      </p>
    </div>

    <h2>4. Systems, monitoring and conduct</h2>
    <p>
      4.1 &nbsp;The Employee shall use only the Company-provided systems, credentials and tools for work, keep
      credentials secret, and not install unauthorised software. The Employee acknowledges that the Company’s systems,
      calls, screens and premises may be monitored and recorded for quality, security and compliance, and consents to
      such monitoring.
    </p>
    <p>
      4.2 &nbsp;The Employee shall follow the client’s calling scripts, disclosures and compliance requirements, treat
      customers courteously and honestly, and shall not misrepresent any product, price or term.
    </p>

    <h2>5. Termination</h2>
    <p>
      5.1 &nbsp;After confirmation, either party may end this employment by giving <b>${notice} days’</b> written
      notice or salary in lieu thereof; during probation, 7 days’ notice applies. Unauthorised absence for 3 or more
      consecutive working days shall be treated as abandonment of service.
    </p>
    <p>
      5.2 &nbsp;The Company may terminate employment immediately, without notice or payment in lieu, for misconduct,
      dishonesty, breach of this Agreement, breach of confidentiality, poor performance after warning, or any act that
      brings the Company or its clients into disrepute.
    </p>
    <p>
      5.3 &nbsp;On leaving for any reason, the Employee shall immediately return all Company property, data, documents
      and access credentials, and shall not retain any copy. The confidentiality and data obligations in Sections 2 and
      3 <b>survive</b> the end of employment indefinitely.
    </p>

    <h2>6. General</h2>
    <p>
      6.1 &nbsp;The Employee confirms that the information given to the Company is true; any false statement or forged
      document is grounds for immediate termination. 6.2 &nbsp;This Agreement, together with the Offer of Employment
      and the Company’s policies, is the entire agreement between the parties and may be amended only in writing.
      6.3 &nbsp;This Agreement is governed by the laws of India; the courts at ${esc(C.city)}, Maharashtra shall have
      exclusive jurisdiction.
    </p>

    <h2>Declaration by the Employee</h2>
    <p>
      I, <b>${esc(name)}</b>, confirm that I have read and fully understood this Agreement (including Section 3.3
      highlighted above), that it has been explained to me, and that I accept it of my own free will as a condition of
      my employment with ${esc(C.shortName)}.
    </p>

    <div class="sig-row">
      <div class="sig">
        <div class="sig-line"></div>
        <div><b>Employee</b></div>
        <div>${esc(name)}<br><span class="muted">Signature &amp; date</span></div>
      </div>
      <div class="sig">
        <div class="sig-line"></div>
        <div><b>For ${esc(C.shortName)}</b></div>
        <div>${esc(hrName)}<br><span class="muted">${esc(hrTitle)} — Signature &amp; date</span></div>
      </div>
    </div>
    <div class="witness">
      <span>Witness 1: ______________________________</span>
      <span>Witness 2: ______________________________</span>
    </div>
  </section>`;

  const css = `
  @page { size: A4; margin: 34mm 16mm 26mm 16mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #111; }
  body { font-family: "Segoe UI", Arial, Helvetica, sans-serif; font-size: 11.2pt; line-height: 1.5; }
  /* Screen preview: an A4 sheet with room for the fixed letterhead + footer. */
  @media screen {
    body { background: #e5e7eb; padding: 24px 0; }
    .sheet { width: 210mm; min-height: 297mm; margin: 0 auto; background: #fff; box-shadow: 0 2px 16px rgba(0,0,0,.15); padding: 34mm 16mm 26mm 16mm; position: relative; }
    .lh { position: absolute; top: 0; left: 0; right: 0; }
    .lf { position: absolute; bottom: 0; left: 0; right: 0; }
    .page-break { border-top: 2px dashed #cbd5e1; margin-top: 18mm; padding-top: 12mm; }
  }
  @media print {
    .sheet { width: auto; padding: 0; box-shadow: none; }
    .lh { position: fixed; top: -30mm; left: 0; right: 0; }
    .lf { position: fixed; bottom: -22mm; left: 0; right: 0; }
    .page-break { page-break-before: always; break-before: page; }
    .no-print { display: none !important; }
    a { color: inherit; text-decoration: none; }
  }
  /* Letterhead — mirrors the Brivent Solutions letterhead. */
  .lh { padding: 8mm 16mm 0; }
  .lh-top { display: flex; align-items: center; gap: 12px; }
  .lh-mark { flex: 0 0 auto; }
  .lh-name { flex: 1; }
  .lh-company { font-size: 22pt; font-weight: 800; letter-spacing: .5px; color: #111; line-height: 1.05; }
  .lh-rule { height: 2px; background: #c9b79c; margin: 4px 0 3px; position: relative; }
  .lh-rule::before, .lh-rule::after { content: ""; position: absolute; top: -3px; width: 8px; height: 8px; border-radius: 50%; background: #c9b79c; }
  .lh-rule::before { left: 0; } .lh-rule::after { right: 0; }
  .lh-tag { font-size: 11pt; color: #111; }
  .lh-tag em { font-style: italic; } .lh-tag b { font-weight: 800; }
  .lh-meta { display: flex; align-items: center; justify-content: center; gap: 14px; margin-top: 6px; font-size: 9.5pt; color: #111; }
  .lh-gst { border: 1.5px solid #c9b79c; border-radius: 6px; padding: 2px 10px; }
  .lh-sep { width: 1px; height: 16px; background: #c9b79c; display: inline-block; }
  .lf { background: #f3f4f6; padding: 5mm 16mm; font-size: 9pt; color: #111; text-align: center; }
  /* Document body */
  .doc { }
  .meta-row { display: flex; justify-content: space-between; font-size: 10.5pt; margin-bottom: 10px; }
  .to { margin: 0 0 14px; }
  .title { text-align: center; font-size: 15pt; letter-spacing: 1px; margin: 10px 0 4px; text-decoration: underline; text-underline-offset: 4px; }
  .subject { margin: 8px 0 12px; }
  .center { text-align: center; }
  .muted { color: #555; font-size: 10pt; }
  p { margin: 0 0 9px; text-align: justify; }
  h2 { font-size: 11.5pt; margin: 14px 0 6px; text-transform: uppercase; letter-spacing: .3px; }
  table.terms { width: 100%; border-collapse: collapse; margin: 6px 0 12px; font-size: 10.8pt; }
  table.terms th, table.terms td { border: 1px solid #cbd5e1; padding: 6px 9px; text-align: left; vertical-align: top; }
  table.terms th { width: 34%; background: #f8fafc; font-weight: 700; }
  /* The highlighted zero-tolerance clause. */
  .alert { border: 2.5px solid #dc2626; background: #fef2f2; border-left-width: 10px; padding: 10px 14px 6px; margin: 12px 0 14px; page-break-inside: avoid; break-inside: avoid; }
  .alert-title { font-weight: 900; color: #b91c1c; font-size: 12pt; letter-spacing: .5px; margin-bottom: 6px; }
  .alert p { color: #111; }
  .alert ol { margin: 4px 0 8px 22px; padding: 0; }
  .alert li { margin: 3px 0; }
  .alert-foot { font-style: italic; font-size: 10.3pt; }
  .sig-row { display: flex; justify-content: space-between; gap: 40px; margin-top: 34px; page-break-inside: avoid; break-inside: avoid; }
  .sig { flex: 1; font-size: 10.5pt; }
  .sig-line { border-bottom: 1.5px solid #111; height: 44px; margin-bottom: 6px; }
  .witness { display: flex; justify-content: space-between; margin-top: 26px; font-size: 10.5pt; page-break-inside: avoid; }
  /* Screen toolbar */
  .toolbar { position: sticky; top: 0; z-index: 10; background: #0f172a; color: #fff; padding: 10px 16px; display: flex; gap: 10px; align-items: center; justify-content: center; font-size: 13px; }
  .toolbar button { background: #16a34a; color: #fff; border: 0; border-radius: 6px; padding: 8px 14px; font-weight: 600; cursor: pointer; }
  .toolbar .hint { color: #cbd5e1; }
  `;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Offer Letter — ${esc(name)}</title>
<style>${css}</style>
</head>
<body>
  <div class="toolbar no-print">
    <button onclick="window.print()">&#11015; Download PDF / Print</button>
    <span class="hint">In the print dialog choose “Save as PDF” (Destination) to download, or pick a printer.</span>
  </div>
  <div class="sheet">
    ${letterhead}
    ${offer}
    ${agreement}
    ${footer}
  </div>
</body>
</html>`;
}

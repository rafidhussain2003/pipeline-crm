// HR — Offer Letter + Employment & Data Protection Agreement generator.
//
// Two SEPARATE print-perfect A4 documents, each self-contained HTML with the
// company letterhead on every page:
//   1. The Offer of Employment (one page).
//   2. The Employment & Data Protection Agreement the employee signs before
//      joining (laid out for exactly TWO pages) — a call-centre-specific
//      agreement whose purpose is to place responsibility for customer PII and
//      company data squarely on the employee, plus the normal employment
//      policies (attendance, leave, conduct, confidentiality, termination).
// "Download PDF" is the browser's native print-to-PDF of each document — no PDF
// library, real logo/colours/highlight preserved, and it prints directly too.
//
// Company identity (name, tagline, GST, phone, email, address, logo) is the
// tenant's letterhead. Today it is the Brivent letterhead the owner supplied;
// it lives in ONE constant so a per-company letterhead can replace it later
// without touching the templates. The HR signatory comes from HR Settings.

export type OfferLetterInput = {
  // Candidate
  candidateName: string;
  fatherOrGuardianName?: string;
  dateOfBirth?: string; // yyyy-mm-dd
  candidateAddress?: string;
  candidatePhone?: string;
  candidateEmail?: string;
  idType?: string; // Aadhaar / PAN / Passport …
  idNumber?: string;
  // Offer
  designation: string;
  department?: string;
  employmentType?: string; // Full-time / Part-time / Contract / Internship
  monthlySalary: string; // pre-formatted number, e.g. "25,000"
  salaryCurrency?: string; // default INR
  incentiveNote?: string;
  joiningDate: string; // yyyy-mm-dd
  workLocation?: string;
  workingHours?: string;
  probationMonths?: number; // default 3
  noticeDays?: number; // default 30
  reportingTo?: string;
  // Meta
  letterDate: string; // yyyy-mm-dd
  referenceNo?: string;
  // HR signatory — from HR Settings (Company HR), not the form.
  hrSignatoryName?: string;
  hrSignatoryTitle?: string;
};

// The letterhead. Sourced from the owner-supplied Brivent Solutions letterhead.
export const COMPANY_LETTERHEAD = {
  name: "BRIVENT SOLUTIONS OPC PVT LTD",
  shortName: "Brivent Solutions OPC Pvt Ltd",
  gst: "27AAOCB5441K1ZB",
  phone: "+91 9906306408",
  email: "enquiry@briventasolutions.com",
  address:
    "Office No. 1004, 10th Floor, Plot. X-5/3, Technocity, next to Bharat Petroleum Petrol Pump, Above ICICI Bank, Mahape, Navi Mumbai, Maharashtra - 400710",
  city: "Navi Mumbai",
} as const;

// The Brivent logomark, reproduced as a vector from the supplied logo image so
// it prints crisply at any size: a rounded "B" whose upper-left is dark, a wide
// tan diagonal band running lower-left → upper-right through the middle, and
// the lower-right dark. Drawn as three overlapping shapes clipped to the B.
const LOGO_SVG = `
<svg viewBox="0 0 100 130" width="44" height="57" aria-label="Brivent Solutions logo" role="img">
  <defs>
    <clipPath id="bshape">
      <path d="M0 0 H62 A32 32 0 0 1 62 64 H0 Z M0 62 H68 A34 34 0 0 1 68 130 H0 Z"/>
    </clipPath>
  </defs>
  <g clip-path="url(#bshape)">
    <rect x="0" y="0" width="100" height="130" fill="#1e1e1e"/>
    <polygon points="-10,88 110,10 110,50 -10,128" fill="#c9b79c"/>
  </g>
</svg>`;

const esc = (s: string | undefined | null) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function fmtDate(iso: string | undefined): string {
  if (!iso) return "";
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
const oneline = (s: string | undefined) => esc((s || "").replace(/\r?\n/g, ", ").replace(/\s+,/g, ",").trim());

// ── Shared chrome ──────────────────────────────────────────────────────────
function letterhead(): string {
  const C = COMPANY_LETTERHEAD;
  return `
  <header class="lh">
    <div class="lh-top">
      <div class="lh-mark">${LOGO_SVG}</div>
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
}
function footer(): string {
  return `<footer class="lf"><b>Office address :</b> ${esc(COMPANY_LETTERHEAD.address)}</footer>`;
}

const CSS = `
  @page { size: A4; margin: 34mm 16mm 24mm 16mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #111; }
  body { font-family: "Segoe UI", Arial, Helvetica, sans-serif; font-size: 10.6pt; line-height: 1.45; }
  @media screen {
    body { background: #e5e7eb; padding: 24px 0; }
    .sheet { width: 210mm; min-height: 297mm; margin: 0 auto 24px; background: #fff; box-shadow: 0 2px 16px rgba(0,0,0,.15); padding: 34mm 16mm 24mm 16mm; position: relative; }
    .lh { position: absolute; top: 0; left: 0; right: 0; }
    .lf { position: absolute; bottom: 0; left: 0; right: 0; }
    .page-break { border-top: 2px dashed #cbd5e1; margin-top: 16mm; padding-top: 12mm; }
  }
  @media print {
    .sheet { width: auto; min-height: 0; padding: 0; box-shadow: none; }
    .lh { position: fixed; top: -30mm; left: 0; right: 0; }
    .lf { position: fixed; bottom: -20mm; left: 0; right: 0; }
    .page-break { page-break-before: always; break-before: page; border: 0; margin: 0; padding: 0; }
    .no-print { display: none !important; }
  }
  /* Letterhead — mirrors the Brivent Solutions letterhead. */
  .lh { padding: 7mm 16mm 0; }
  .lh-top { display: flex; align-items: center; gap: 12px; }
  .lh-mark { flex: 0 0 auto; line-height: 0; }
  .lh-name { flex: 1; }
  .lh-company { font-size: 21pt; font-weight: 800; letter-spacing: .4px; color: #1e1e1e; line-height: 1.05; }
  .lh-rule { height: 2px; background: #c9b79c; margin: 4px 0 3px; position: relative; }
  .lh-rule::before, .lh-rule::after { content: ""; position: absolute; top: -3px; width: 8px; height: 8px; border-radius: 50%; background: #c9b79c; }
  .lh-rule::before { left: 0; } .lh-rule::after { right: 0; }
  .lh-tag { font-size: 10.5pt; color: #1e1e1e; }
  .lh-tag em { font-style: italic; } .lh-tag b { font-weight: 800; }
  .lh-meta { display: flex; align-items: center; justify-content: center; gap: 14px; margin-top: 5px; font-size: 9pt; color: #1e1e1e; }
  .lh-gst { border: 1.5px solid #c9b79c; border-radius: 6px; padding: 1px 10px; }
  .lh-sep { width: 1px; height: 15px; background: #c9b79c; display: inline-block; }
  .lf { background: #f3f4f6; padding: 4.5mm 16mm; font-size: 8.6pt; color: #1e1e1e; text-align: center; }
  /* Document body */
  .meta-row { display: flex; justify-content: space-between; font-size: 10pt; margin-bottom: 8px; }
  .to { margin: 0 0 12px; }
  .title { text-align: center; font-size: 14.5pt; letter-spacing: 1px; margin: 6px 0 4px; text-decoration: underline; text-underline-offset: 4px; }
  .subject { margin: 6px 0 10px; }
  .center { text-align: center; }
  .muted { color: #555; font-size: 9.5pt; }
  p { margin: 0 0 7px; text-align: justify; }
  h2 { font-size: 10.8pt; margin: 10px 0 4px; text-transform: uppercase; letter-spacing: .3px; }
  table.terms { width: 100%; border-collapse: collapse; margin: 6px 0 10px; font-size: 10.2pt; }
  table.terms th, table.terms td { border: 1px solid #cbd5e1; padding: 5px 8px; text-align: left; vertical-align: top; }
  table.terms th { width: 32%; background: #f8fafc; font-weight: 700; }
  table.parties { width: 100%; border-collapse: collapse; margin: 4px 0 8px; font-size: 10pt; }
  table.parties td { padding: 2px 6px 2px 0; vertical-align: top; }
  table.parties td:first-child { width: 30%; color: #444; }
  /* The highlighted zero-tolerance clause. */
  .alert { border: 2.5px solid #dc2626; background: #fef2f2; border-left-width: 10px; padding: 8px 12px 4px; margin: 8px 0 10px; page-break-inside: avoid; break-inside: avoid; }
  .alert-title { font-weight: 900; color: #b91c1c; font-size: 11.5pt; letter-spacing: .5px; margin-bottom: 4px; }
  .alert p { color: #111; margin-bottom: 5px; }
  .alert ol { margin: 2px 0 6px 20px; padding: 0; }
  .alert li { margin: 2px 0; }
  .alert-foot { font-style: italic; font-size: 9.8pt; }
  .sig-row { display: flex; justify-content: space-between; gap: 40px; margin-top: 26px; page-break-inside: avoid; break-inside: avoid; }
  .sig { flex: 1; font-size: 10pt; }
  .sig-line { border-bottom: 1.5px solid #111; height: 40px; margin-bottom: 5px; }
  .witness { display: flex; justify-content: space-between; margin-top: 18px; font-size: 10pt; page-break-inside: avoid; }
  .toolbar { position: sticky; top: 0; z-index: 10; background: #0f172a; color: #fff; padding: 10px 16px; display: flex; gap: 10px; align-items: center; justify-content: center; font-size: 13px; }
  .toolbar button { background: #16a34a; color: #fff; border: 0; border-radius: 6px; padding: 8px 14px; font-weight: 600; cursor: pointer; }
  .toolbar .hint { color: #cbd5e1; }
`;

function shell(bodyHtml: string, filename: string): string {
  // The document <title> doubles as the default "Save as PDF" filename in the
  // browser's print dialog, so it is the intended PDF name from the start.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(filename)}</title>
<style>${CSS}</style>
</head>
<body>
  <div class="toolbar no-print">
    <button id="print-btn" type="button">&#11015; Download PDF / Print</button>
    <span class="hint">In the print dialog choose “Save as PDF” (Destination) to download, or pick a printer. Shortcut: Ctrl+P / Cmd+P.</span>
  </div>
  <div class="sheet">
    ${letterhead()}
    ${bodyHtml}
    ${footer()}
  </div>
  <script>
    // Bound as a real listener (not an inline handler) so it runs in every
    // browser context; Ctrl+P works too, and the title is the PDF filename.
    (function () {
      var btn = document.getElementById("print-btn");
      if (btn) btn.addEventListener("click", function () { window.focus(); window.print(); });
    })();
  </script>
</body>
</html>`;
}

function commonVars(input: OfferLetterInput) {
  const C = COMPANY_LETTERHEAD;
  return {
    C,
    name: input.candidateName.trim(),
    currency: input.salaryCurrency?.trim() || "INR",
    probation: input.probationMonths ?? 3,
    notice: input.noticeDays ?? 30,
    employmentType: input.employmentType?.trim() || "Full-time",
    workingHours: input.workingHours?.trim() || "as per the shift schedule assigned by the Company (international / US-hours process)",
    workLocation: input.workLocation?.trim() || `${C.shortName}, ${C.city}`,
    hrName: input.hrSignatoryName?.trim() || "Authorised Signatory",
    hrTitle: input.hrSignatoryTitle?.trim() || "Human Resources",
  };
}

// ── Document 1: Offer of Employment ─────────────────────────────────────────
export function buildOfferLetterHtml(input: OfferLetterInput): string {
  const v = commonVars(input);
  const ref = input.referenceNo?.trim();
  const body = `
  <section class="doc">
    <div class="meta-row">
      <div>${ref ? `<b>Ref:</b> ${esc(ref)}` : ""}</div>
      <div><b>Date:</b> ${fmtDate(input.letterDate)}</div>
    </div>

    <p class="to">
      <b>To,</b><br>
      <b>${esc(v.name)}</b>${input.fatherOrGuardianName ? `<br>S/o, D/o, W/o: ${esc(input.fatherOrGuardianName)}` : ""}<br>
      ${input.candidateAddress ? `${multiline(input.candidateAddress)}<br>` : ""}
      ${input.candidatePhone ? `Phone: ${esc(input.candidatePhone)}<br>` : ""}
      ${input.candidateEmail ? `Email: ${esc(input.candidateEmail)}` : ""}
    </p>

    <h1 class="title">OFFER OF EMPLOYMENT</h1>
    <p class="subject"><b>Subject:</b> Offer for the position of <b>${esc(input.designation)}</b></p>

    <p>Dear ${esc(v.name)},</p>
    <p>
      Further to your interview and subsequent discussions with us, we are pleased to offer you employment with
      <b>${esc(v.C.shortName)}</b> (hereinafter “the Company”) on the following terms and conditions:
    </p>

    <table class="terms">
      <tr><th>Position</th><td>${esc(input.designation)}${input.department ? ` — ${esc(input.department)}` : ""}</td></tr>
      <tr><th>Nature of employment</th><td>${esc(v.employmentType)}</td></tr>
      <tr><th>Date of joining</th><td>${fmtDate(input.joiningDate)}</td></tr>
      <tr><th>Place of work</th><td>${esc(v.workLocation)}</td></tr>
      <tr><th>Working hours</th><td>${esc(v.workingHours)}</td></tr>
      <tr><th>Monthly salary</th><td><b>${esc(v.currency)} ${esc(input.monthlySalary)}</b> per month (gross)${input.incentiveNote ? `, ${esc(input.incentiveNote)}` : ""}</td></tr>
      ${input.reportingTo ? `<tr><th>Reporting to</th><td>${esc(input.reportingTo)}</td></tr>` : ""}
      <tr><th>Probation</th><td>${v.probation} month${v.probation === 1 ? "" : "s"} from the date of joining, extendable at the Company’s discretion</td></tr>
      <tr><th>Notice period</th><td>${v.notice} days (either side) after confirmation; during probation, 7 days’ notice by either party</td></tr>
    </table>

    <p>
      This offer is subject to (a) satisfactory verification of the documents you submit (identity, address,
      educational and prior-employment records) and (b) your signing of the <b>Employment &amp; Data Protection
      Agreement</b> issued along with this letter, which forms an integral part of your terms of employment. Salary
      is payable monthly in arrears, subject to statutory deductions, and is confidential between you and the Company.
    </p>
    <p>
      Your employment is governed by the Company’s policies, rules and code of conduct as amended from time to time.
      Please sign and return the duplicate copy of this letter, together with the signed Agreement, as your acceptance
      on or before your date of joining.
    </p>
    <p>We welcome you to ${esc(v.C.shortName)} and look forward to a long and successful association.</p>

    <div class="sig-row">
      <div class="sig">
        <div class="sig-line"></div>
        <div><b>For ${esc(v.C.shortName)}</b></div>
        <div>${esc(v.hrName)}<br><span class="muted">${esc(v.hrTitle)}</span></div>
      </div>
      <div class="sig">
        <div class="sig-line"></div>
        <div><b>Accepted by</b></div>
        <div>${esc(v.name)}<br><span class="muted">Signature &amp; date</span></div>
      </div>
    </div>
  </section>`;
  return shell(body, `Offer Letter - ${v.name}`);
}

// ── Document 2: Employment & Data Protection Agreement (two pages) ───────────
export function buildAgreementHtml(input: OfferLetterInput): string {
  const v = commonVars(input);
  const page1 = `
  <section class="doc">
    <h1 class="title">EMPLOYMENT &amp; DATA PROTECTION AGREEMENT</h1>
    <p class="center muted">Dated ${fmtDate(input.letterDate)}${input.referenceNo ? ` &nbsp;·&nbsp; Ref: ${esc(input.referenceNo)}` : ""}</p>

    <p>
      This Agreement is made between <b>${esc(v.C.shortName)}</b>, having its office at ${esc(v.C.address)}
      (“the Company”), and the employee whose particulars are given below (“the Employee”):
    </p>
    <table class="parties">
      <tr><td>Name</td><td><b>${esc(v.name)}</b></td></tr>
      ${input.fatherOrGuardianName ? `<tr><td>Father’s / Guardian’s name</td><td>${esc(input.fatherOrGuardianName)}</td></tr>` : ""}
      ${input.dateOfBirth ? `<tr><td>Date of birth</td><td>${fmtDate(input.dateOfBirth)}</td></tr>` : ""}
      ${input.candidateAddress ? `<tr><td>Address</td><td>${oneline(input.candidateAddress)}</td></tr>` : ""}
      ${input.candidatePhone || input.candidateEmail ? `<tr><td>Contact</td><td>${esc([input.candidatePhone, input.candidateEmail].filter(Boolean).join(" · "))}</td></tr>` : ""}
      ${input.idType || input.idNumber ? `<tr><td>ID (${esc(input.idType || "Govt. ID")})</td><td>${esc(input.idNumber || "")}</td></tr>` : ""}
      <tr><td>Position</td><td>${esc(input.designation)}${input.department ? `, ${esc(input.department)}` : ""} — ${esc(v.employmentType)}</td></tr>
      <tr><td>Date of joining</td><td>${fmtDate(input.joiningDate)}</td></tr>
    </table>

    <h2>1. Nature of the business</h2>
    <p>
      The Company operates an international business process outsourcing (BPO) / call-centre operation. On behalf of
      its clients, the Employee will contact prospective customers, present and sell the clients’ products and
      services (television, internet, telecommunications and related products), and process orders. In the course of
      this work the Employee will receive, hear or handle customers’ personal and financial information.
    </p>

    <h2>2. Customer personal &amp; financial information — the Employee’s duty</h2>
    <p>
      2.1 “Customer Information” means any information relating to a customer or prospective customer: name, address,
      telephone number, email, date of birth, government identification or social security numbers, payment-card
      numbers, bank details, account credentials, and any order or verification details.
    </p>
    <p>
      2.2 Customer Information may be used <b>solely</b> to verify and place the customer’s order with the client, at
      the time of the call, in accordance with the client’s procedures.
    </p>
    <p>
      2.3 The Employee may note Customer Information only transiently (for example on a notepad) while verifying it,
      and <b>must delete and destroy every copy of it — written, typed, saved, photographed or otherwise —
      immediately after the order has been placed and the customer’s service activated.</b> No Customer Information
      may be retained, stored, copied, photographed, forwarded, transmitted or taken out of the Company’s premises or
      systems in any form, at any time, for any reason.
    </p>
    <p>
      2.4 <b>Deletion is the Employee’s personal responsibility.</b> The Company provides the leads and the opportunity
      to place orders; the safekeeping and immediate destruction of Customer Information handled by the Employee is
      the Employee’s own obligation, and the Employee confirms they alone control what they note, save or retain.
    </p>
    <p>
      2.5 Any misuse of Customer Information by the Employee — fraud, unauthorised transactions, identity theft,
      sharing or selling of information, or any use outside the client’s order process — is a criminal act committed by
      the Employee in their individual capacity, wholly outside the scope of employment and against the Company’s
      express instructions. <b>The Employee shall be solely and personally liable</b>, civilly and criminally, for any
      such act and for all loss, claims, penalties and legal costs arising from it, and shall indemnify and hold the
      Company harmless in full. The Company will cooperate with the authorities and affected parties in any such matter.
    </p>

    <h2>3. Company data, leads and confidentiality</h2>
    <p>
      3.1 “Company Data” means all leads (including any customer’s name, telephone number, email or other details),
      lead lists, client information, sales records, scripts, pricing, systems access, reports and any other business
      information of the Company or its clients, in any form. 3.2 Company Data is the exclusive property of the
      Company. The Employee shall use it only for the Company’s work, on the Company’s systems, and keep it strictly
      confidential during and after employment.
    </p>

    <div class="alert">
      <div class="alert-title">&#9888; &nbsp;3.3 &nbsp;DATA THEFT — ZERO TOLERANCE</div>
      <p>
        The Employee shall <b>NOT</b>, under any circumstances: transfer, send, forward, share, copy, upload, message,
        email, photograph, screenshot, write down for removal, or otherwise take <b>ANY Company Data outside the
        Company — not even a single lead</b> (a customer’s name, number or email included) — to a personal device,
        personal email, cloud storage, messaging application, social-media account, another person, or any third party.
      </p>
      <p>
        The Employee shall <b>NOT</b> use personal Instagram, Facebook, WhatsApp, Telegram or any social-media or
        messaging service, nor any personal mobile phone or camera, on the Company’s computers, network or premises in
        relation to Company Data, and shall <b>NOT</b> take pictures, screenshots or recordings of any screen, document
        or data belonging to the Company or its clients.
      </p>
      <p><b>If the Employee is found doing, or attempting to do, any of the above, the following shall apply immediately:</b></p>
      <ol>
        <li><b>Immediate termination</b> of employment without notice.</li>
        <li><b>Forfeiture</b> of all salary, incentives, commissions and other amounts then due or accrued to the
            Employee, which stand forfeited to the Company as liquidated damages.</li>
        <li>A <b>fine of INR 50,000 (Rupees Fifty Thousand) up to INR 1,00,000 (Rupees One Lakh)</b>, as determined by
            the Company according to the gravity of the breach, payable by the Employee on demand.</li>
        <li>A <b>police complaint / FIR</b> and such civil and criminal action as the Company deems fit, including under
            the Information Technology Act, 2000 and the Indian Penal Code / Bharatiya Nyaya Sanhita.</li>
      </ol>
      <p class="alert-foot">
        The Employee acknowledges that these consequences are reasonable and proportionate to the harm such theft causes
        the Company and its clients, and agrees to them knowingly and voluntarily.
      </p>
    </div>
  </section>`;

  const page2 = `
  <section class="doc page-break">
    <h2>4. Systems, monitoring and conduct</h2>
    <p>
      4.1 The Employee shall use only Company-provided systems, credentials and tools for work, keep credentials secret,
      and not install unauthorised software or connect unauthorised devices. 4.2 The Employee acknowledges that the
      Company’s systems, calls, screens and premises may be monitored and recorded for quality, security and compliance,
      and consents to such monitoring. 4.3 The Employee shall follow the client’s calling scripts, disclosures and
      compliance requirements, treat customers courteously and honestly, and shall not misrepresent any product, price
      or term, nor place any order without the customer’s clear consent.
    </p>

    <h2>5. Attendance, hours and leave</h2>
    <p>
      5.1 Working hours: ${esc(v.workingHours)}. The Employee shall report punctually for every scheduled shift; the
      Company may change shift timings with reasonable notice as client requirements demand. 5.2 Leave is granted as
      per the Company’s leave policy and must be applied for and approved in advance; unapproved absence is treated as
      leave without pay. 5.3 Unauthorised absence for three (3) or more consecutive working days shall be treated as
      abandonment of service.
    </p>

    <h2>6. Salary, incentives and deductions</h2>
    <p>
      6.1 Salary is payable monthly in arrears, subject to statutory deductions and to attendance. 6.2 Incentives and
      commissions, where offered, are payable strictly as per the Company’s incentive policy in force, on sales that
      are activated and not cancelled or charged back within the client’s qualifying period, and are not payable for
      any period in which the Employee is in breach of this Agreement. 6.3 The Company may recover from any amount due
      to the Employee any advance, loss or damage caused by the Employee’s negligence, misconduct or breach.
    </p>

    <h2>7. Confidentiality and non-solicitation</h2>
    <p>
      7.1 The Employee shall keep confidential, during and after employment, all Company Data, client identities,
      pricing, processes and any information not publicly known. 7.2 For twelve (12) months after leaving, the Employee
      shall not solicit or divert the Company’s clients or customers, nor solicit the Company’s employees to leave, and
      shall not use or disclose any Company Data or lead in any other business.
    </p>

    <h2>8. Termination</h2>
    <p>
      8.1 After confirmation, either party may end this employment by giving <b>${v.notice} days’</b> written notice or
      salary in lieu; during probation of ${v.probation} month${v.probation === 1 ? "" : "s"}, 7 days’ notice applies.
      8.2 The Company may terminate employment immediately, without notice or payment in lieu, for misconduct,
      dishonesty, breach of this Agreement or of confidentiality, poor performance after warning, or any act that brings
      the Company or its clients into disrepute. 8.3 On leaving for any reason, the Employee shall immediately return
      all Company property, data, documents and access credentials, retain no copy, and complete the exit formalities;
      final settlement is made only after clearance. 8.4 The obligations in Sections 2, 3 and 7 <b>survive</b> the end
      of employment indefinitely.
    </p>

    <h2>9. General</h2>
    <p>
      9.1 The Employee confirms that the particulars and documents given to the Company are true; any false statement
      or forged document is grounds for immediate termination. 9.2 This Agreement, together with the Offer of
      Employment and the Company’s policies, is the entire agreement between the parties and may be amended only in
      writing signed by both. 9.3 This Agreement is governed by the laws of India; the courts at ${esc(v.C.city)},
      Maharashtra shall have exclusive jurisdiction.
    </p>

    <h2>Declaration by the Employee</h2>
    <p>
      I, <b>${esc(v.name)}</b>, confirm that I have read and fully understood this Agreement (including Section 3.3
      highlighted on the previous page), that it has been explained to me in a language I understand, and that I accept
      it of my own free will as a condition of my employment with ${esc(v.C.shortName)}.
    </p>

    <div class="sig-row">
      <div class="sig">
        <div class="sig-line"></div>
        <div><b>Employee</b></div>
        <div>${esc(v.name)}<br><span class="muted">Signature &amp; date</span></div>
      </div>
      <div class="sig">
        <div class="sig-line"></div>
        <div><b>For ${esc(v.C.shortName)}</b></div>
        <div>${esc(v.hrName)}<br><span class="muted">${esc(v.hrTitle)} — Signature &amp; date</span></div>
      </div>
    </div>
    <div class="witness">
      <span>Witness 1: ______________________________</span>
      <span>Witness 2: ______________________________</span>
    </div>
  </section>`;

  return shell(page1 + page2, `Employment Agreement - ${v.name}`);
}

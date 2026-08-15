import { NextRequest, NextResponse } from "next/server";
import { requireHR } from "@/lib/hr/guard";
import { getHRSettings } from "@/lib/hr/settings";
import type { OfferLetterInput } from "@/lib/hr/offer-letter";
import { renderOfferLetterPdf, renderAgreementPdf } from "@/lib/hr/offer-letter-pdf";
import { recordAudit } from "@/lib/audit";
import { checkPolicy } from "@/lib/rate-limit";

// Generate the Offer Letter or the Employment & Data Protection Agreement as a
// REAL PDF file (rendered server-side with pdf-lib) — the response is
// application/pdf with a Content-Disposition attachment, so the browser saves
// it straight to the computer: no print dialog, no web page, no browser
// headers/footers. ?doc=offer | agreement. Admin/HR only (hr:manage). The HR
// signatory printed on both comes from HR Settings ("Company HR"), never from
// the form. Stateless: nothing is stored; each generation is audited.
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateOrEmpty = (v: unknown) => (DATE_RE.test(str(v, 10)) ? str(v, 10) : "");
const intOr = (v: unknown, min: number, max: number) =>
  v === "" || v === null || v === undefined || !Number.isFinite(Number(v)) ? undefined : Math.max(min, Math.min(max, Math.floor(Number(v))));
// A safe filename: letters, digits, space, dash, underscore, dot.
const fileSafe = (s: string) => s.replace(/[^A-Za-z0-9 ._-]+/g, "").trim().slice(0, 80) || "document";

export async function POST(req: NextRequest) {
  const auth = await requireHR("hr:manage");
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const rl = checkPolicy("api.authenticated", session.userId);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const doc = req.nextUrl.searchParams.get("doc") === "agreement" ? "agreement" : "offer";
  const body = await req.json().catch(() => ({}));
  const today = new Date().toISOString().slice(0, 10);
  const settings = await getHRSettings(session.companyId);

  const input: OfferLetterInput = {
    candidateName: str(body.candidateName, 120),
    fatherOrGuardianName: str(body.fatherOrGuardianName, 120) || undefined,
    dateOfBirth: dateOrEmpty(body.dateOfBirth) || undefined,
    candidateAddress: str(body.candidateAddress, 400) || undefined,
    candidatePhone: str(body.candidatePhone, 40) || undefined,
    candidateEmail: str(body.candidateEmail, 120) || undefined,
    idType: str(body.idType, 40) || undefined,
    idNumber: str(body.idNumber, 60) || undefined,
    designation: str(body.designation, 100),
    department: str(body.department, 100) || undefined,
    employmentType: str(body.employmentType, 40) || undefined,
    monthlySalary: str(body.monthlySalary, 40),
    salaryCurrency: str(body.salaryCurrency, 10) || undefined,
    incentiveNote: str(body.incentiveNote, 200) || undefined,
    joiningDate: dateOrEmpty(body.joiningDate),
    workLocation: str(body.workLocation, 200) || undefined,
    workingHours: str(body.workingHours, 200) || undefined,
    probationMonths: intOr(body.probationMonths, 0, 24),
    noticeDays: intOr(body.noticeDays, 0, 180),
    reportingTo: str(body.reportingTo, 100) || undefined,
    letterDate: dateOrEmpty(body.letterDate) || today,
    referenceNo: str(body.referenceNo, 60) || undefined,
    // From HR Settings — the Company HR who signs.
    hrSignatoryName: settings.hrSignatoryName || undefined,
    hrSignatoryTitle: settings.hrSignatoryTitle || undefined,
  };

  if (!input.candidateName) return NextResponse.json({ error: "Agent's full name is required." }, { status: 400 });
  if (!input.designation) return NextResponse.json({ error: "Designation / position is required." }, { status: 400 });
  if (!input.monthlySalary) return NextResponse.json({ error: "Monthly salary is required." }, { status: 400 });
  if (!input.joiningDate) return NextResponse.json({ error: "A valid joining date is required." }, { status: 400 });
  if (!settings.hrSignatoryName) {
    return NextResponse.json(
      { error: "Set the Company HR (signatory) name in HR → Settings first — it is printed on the offer letter and agreement." },
      { status: 400 }
    );
  }

  // Audit once per generation (the page requests both documents; audit the
  // offer letter as the generation event, the agreement as its companion).
  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: doc === "offer" ? "hr.offer_letter_generated" : "hr.employment_agreement_generated",
    entityType: "hr_offer_letter",
    metadata: { candidateName: input.candidateName, designation: input.designation, joiningDate: input.joiningDate, hrSignatory: settings.hrSignatoryName },
  });

  const bytes = doc === "offer" ? await renderOfferLetterPdf(input) : await renderAgreementPdf(input);
  const filename = doc === "offer" ? `Offer Letter - ${fileSafe(input.candidateName)}.pdf` : `Employment Agreement - ${fileSafe(input.candidateName)}.pdf`;

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
    },
  });
}

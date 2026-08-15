import { NextRequest, NextResponse } from "next/server";
import { requireHR } from "@/lib/hr/guard";
import { buildOfferLetterHtml, type OfferLetterInput } from "@/lib/hr/offer-letter";
import { recordAudit } from "@/lib/audit";
import { checkPolicy } from "@/lib/rate-limit";

// Generate an Offer Letter + Employment & Data Protection Agreement as a
// print-perfect HTML document (Download PDF = the browser's print-to-PDF).
// Admin/HR only (hr:manage) — agents can never reach this. Stateless: nothing
// is stored; the letter is generated fresh from the form each time and the
// generation itself is audited.
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: NextRequest) {
  const auth = await requireHR("hr:manage");
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const rl = checkPolicy("api.authenticated", session.userId);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const today = new Date().toISOString().slice(0, 10);

  const input: OfferLetterInput = {
    candidateName: str(body.candidateName, 120),
    candidateAddress: str(body.candidateAddress, 400) || undefined,
    candidatePhone: str(body.candidatePhone, 40) || undefined,
    candidateEmail: str(body.candidateEmail, 120) || undefined,
    designation: str(body.designation, 100),
    department: str(body.department, 100) || undefined,
    employmentType: str(body.employmentType, 40) || undefined,
    monthlySalary: str(body.monthlySalary, 40),
    salaryCurrency: str(body.salaryCurrency, 10) || undefined,
    incentiveNote: str(body.incentiveNote, 200) || undefined,
    joiningDate: DATE_RE.test(str(body.joiningDate, 10)) ? str(body.joiningDate, 10) : "",
    workLocation: str(body.workLocation, 200) || undefined,
    workingHours: str(body.workingHours, 200) || undefined,
    probationMonths: Number.isFinite(Number(body.probationMonths)) && body.probationMonths !== "" && body.probationMonths !== null ? Math.max(0, Math.min(24, Math.floor(Number(body.probationMonths)))) : undefined,
    noticeDays: Number.isFinite(Number(body.noticeDays)) && body.noticeDays !== "" && body.noticeDays !== null ? Math.max(0, Math.min(180, Math.floor(Number(body.noticeDays)))) : undefined,
    reportingTo: str(body.reportingTo, 100) || undefined,
    letterDate: DATE_RE.test(str(body.letterDate, 10)) ? str(body.letterDate, 10) : today,
    referenceNo: str(body.referenceNo, 60) || undefined,
    hrSignatoryName: str(body.hrSignatoryName, 100) || undefined,
    hrSignatoryTitle: str(body.hrSignatoryTitle, 100) || undefined,
  };

  if (!input.candidateName) return NextResponse.json({ error: "Candidate name is required." }, { status: 400 });
  if (!input.designation) return NextResponse.json({ error: "Designation / position is required." }, { status: 400 });
  if (!input.monthlySalary) return NextResponse.json({ error: "Monthly salary is required." }, { status: 400 });
  if (!input.joiningDate) return NextResponse.json({ error: "A valid joining date (yyyy-mm-dd) is required." }, { status: 400 });

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "hr.offer_letter_generated",
    entityType: "hr_offer_letter",
    metadata: { candidateName: input.candidateName, designation: input.designation, joiningDate: input.joiningDate },
  });

  const html = buildOfferLetterHtml(input);
  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // The document is a same-origin, no-script page rendered in the app's
      // own iframe/tab; keep it from being framed elsewhere.
      "X-Frame-Options": "SAMEORIGIN",
    },
  });
}

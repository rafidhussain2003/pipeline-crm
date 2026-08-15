// HR — Offer Letter + Employment & Data Protection Agreement: the shared
// contract. The documents themselves are rendered as real PDF files by
// ./offer-letter-pdf.ts (server-side, pdf-lib) and downloaded directly.
//
// Company identity (name, tagline, GST, phone, email, address) is the tenant's
// letterhead. Today it is the Brivent letterhead the owner supplied; it lives
// in ONE constant so a per-company letterhead can replace it later without
// touching the renderer. The HR signatory comes from HR Settings.

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

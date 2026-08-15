"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// HR — Offer Letter generator. Fill in the agent's details (or prefill from an
// existing employee), click Generate: TWO print-ready A4 documents open in new
// tabs — the Offer Letter and the Employment & Data Protection Agreement (two
// pages) — each with its own "Download PDF / Print" button (the browser's
// print-to-PDF: real letterhead, logo, colours and the highlighted data-theft
// clause preserved). Print, collect the agent's and HR's signatures. The HR
// signatory on both documents is the Company HR set in HR → Settings.
// Admin/HR only.

type Employee = {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  departmentName: string | null;
  designationTitle: string | null;
};

const today = () => new Date().toISOString().slice(0, 10);

const EMPTY = {
  candidateName: "",
  fatherOrGuardianName: "",
  dateOfBirth: "",
  candidateAddress: "",
  candidatePhone: "",
  candidateEmail: "",
  idType: "Aadhaar",
  idNumber: "",
  designation: "Sales Agent",
  department: "",
  employmentType: "Full-time",
  monthlySalary: "",
  salaryCurrency: "INR",
  incentiveNote: "plus performance incentives / commissions as per company policy",
  joiningDate: "",
  workLocation: "",
  workingHours: "",
  probationMonths: "3",
  noticeDays: "30",
  reportingTo: "",
  letterDate: today(),
  referenceNo: "",
};
type Form = typeof EMPTY;

export default function OfferLetterPage() {
  const [form, setForm] = useState<Form>(EMPTY);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [prefillId, setPrefillId] = useState("");
  const [hr, setHr] = useState<{ name: string | null; title: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    fetch("/api/hr/employees?limit=200")
      .then((r) => {
        if (r.status === 403) {
          setForbidden(true);
          return { employees: [] };
        }
        return r.ok ? r.json() : { employees: [] };
      })
      .then((d) => setEmployees(d.employees || []))
      .catch(() => {});
    fetch("/api/hr/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setHr({ name: d.settings?.hrSignatoryName ?? null, title: d.settings?.hrSignatoryTitle ?? null }))
      .catch(() => {});
  }, []);

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  function prefill(id: string) {
    setPrefillId(id);
    const e = employees.find((x) => x.id === id);
    if (!e) return;
    setForm((f) => ({
      ...f,
      candidateName: [e.firstName, e.lastName].filter(Boolean).join(" "),
      candidateEmail: e.email || f.candidateEmail,
      designation: e.designationTitle || f.designation,
      department: e.departmentName || f.department,
    }));
  }

  // Open a finished document in its own tab as a real Blob URL. (Writing the
  // HTML into an about:blank window gives it an opaque origin, and Chrome then
  // silently ignores window.print() from that page — the Download PDF button
  // did nothing. A blob: URL has a proper origin, so printing works and the
  // print dialog offers "Save as PDF" with the document title as filename.)
  function openDoc(html: string): boolean {
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const w = window.open(url, "_blank");
    if (!w) {
      URL.revokeObjectURL(url);
      return false;
    }
    // Release the blob once the tab has had time to load it.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return true;
  }

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/hr/offer-letter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Could not generate (${res.status})`);
        return;
      }
      const ok1 = openDoc(data.offerHtml);
      const ok2 = openDoc(data.agreementHtml);
      if (!ok1 || !ok2) {
        setError("Your browser blocked one of the two document tabs. Allow pop-ups for this site and click Generate again.");
      }
    } catch {
      setError("Could not generate the documents. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (forbidden) {
    return <div className="p-6 text-sm text-slate-500">Only an admin / HR can generate offer letters.</div>;
  }

  const field = (
    key: keyof Form,
    label: string,
    opts: { type?: string; placeholder?: string; required?: boolean; span2?: boolean; textarea?: boolean } = {}
  ) => (
    <div className={opts.span2 ? "sm:col-span-2" : ""}>
      <label className="block text-xs font-medium text-slate-600 mb-1">
        {label}
        {opts.required && <span className="text-red-500"> *</span>}
      </label>
      {opts.textarea ? (
        <textarea
          value={form[key]}
          onChange={set(key)}
          placeholder={opts.placeholder}
          rows={3}
          className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      ) : (
        <input
          type={opts.type || "text"}
          value={form[key]}
          onChange={set(key)}
          placeholder={opts.placeholder}
          required={opts.required}
          className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      )}
    </div>
  );

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-slate-900">Offer Letter</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Generates two documents on the company letterhead — the <b>Offer of Employment</b> and the{" "}
          <b>Employment &amp; Data Protection Agreement</b> (2 pages). Each opens print-ready with a{" "}
          <b>Download PDF / Print</b> button; print both and collect the agent’s and HR’s signatures.
        </p>
      </div>

      {/* Company HR (signatory) — from HR Settings */}
      <div className={`rounded-lg border px-4 py-3 mb-5 text-sm ${hr?.name ? "bg-white border-slate-200" : "bg-amber-50 border-amber-200"}`}>
        {hr?.name ? (
          <>
            <span className="text-slate-500">Signed by (Company HR): </span>
            <b className="text-slate-900">{hr.name}</b>
            {hr.title && <span className="text-slate-500"> — {hr.title}</span>}
            <span className="text-slate-400"> · </span>
            <Link href="/hr/settings" className="text-blue-600 hover:underline">change in HR Settings</Link>
          </>
        ) : (
          <>
            <b className="text-amber-900">Company HR not set.</b>{" "}
            <span className="text-amber-800">
              The HR name is printed on both documents — set it in{" "}
              <Link href="/hr/settings" className="underline font-medium">HR → Settings → Company HR (signatory)</Link> first.
            </span>
          </>
        )}
      </div>

      <form onSubmit={generate} className="space-y-5">
        {/* Prefill */}
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <label className="block text-xs font-medium text-slate-600 mb-1">Prefill from an existing employee (optional)</label>
          <select value={prefillId} onChange={(e) => prefill(e.target.value)} className="w-full sm:w-96 rounded-md border border-slate-200 px-3 py-2 text-sm">
            <option value="">— Type details manually —</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {[e.firstName, e.lastName].filter(Boolean).join(" ")}
                {e.designationTitle ? ` · ${e.designationTitle}` : ""}
              </option>
            ))}
          </select>
        </div>

        {/* Agent details */}
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-sm font-semibold text-slate-800 mb-3">Agent details</div>
          <div className="grid sm:grid-cols-2 gap-3">
            {field("candidateName", "Full name", { required: true, placeholder: "e.g. Rahul Sharma" })}
            {field("fatherOrGuardianName", "Father’s / Guardian’s name", { placeholder: "e.g. Suresh Sharma" })}
            {field("dateOfBirth", "Date of birth", { type: "date" })}
            {field("candidatePhone", "Phone", { placeholder: "+91 …" })}
            {field("candidateEmail", "Email", { type: "email" })}
            <div className="grid grid-cols-[120px_1fr] gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">ID type</label>
                <select value={form.idType} onChange={set("idType")} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
                  {["Aadhaar", "PAN", "Passport", "Voter ID", "Driving Licence"].map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              {field("idNumber", "ID number", { placeholder: "e.g. XXXX-XXXX-XXXX" })}
            </div>
            {field("candidateAddress", "Address", { textarea: true, span2: true, placeholder: "House / street, area, city, state – PIN" })}
          </div>
        </div>

        {/* Offer terms */}
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-sm font-semibold text-slate-800 mb-3">Offer terms</div>
          <div className="grid sm:grid-cols-2 gap-3">
            {field("designation", "Designation / position", { required: true, placeholder: "e.g. Sales Agent" })}
            {field("department", "Department", { placeholder: "e.g. Sales" })}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Nature of employment</label>
              <select value={form.employmentType} onChange={set("employmentType")} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
                {["Full-time", "Part-time", "Contract", "Internship"].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            {field("joiningDate", "Date of joining", { type: "date", required: true })}
            <div className="grid grid-cols-[90px_1fr] gap-2">
              {field("salaryCurrency", "Currency", { placeholder: "INR" })}
              {field("monthlySalary", "Monthly salary (gross)", { required: true, placeholder: "e.g. 25,000" })}
            </div>
            {field("incentiveNote", "Incentive note", { placeholder: "plus performance incentives …" })}
            {field("workLocation", "Place of work", { placeholder: "Defaults to the company office" })}
            {field("workingHours", "Working hours / shift", { placeholder: "e.g. 8:00 PM – 5:00 AM IST (US shift), Mon–Fri" })}
            {field("probationMonths", "Probation (months)", { type: "number" })}
            {field("noticeDays", "Notice period (days)", { type: "number" })}
            {field("reportingTo", "Reporting to", { placeholder: "e.g. Floor Manager" })}
          </div>
        </div>

        {/* Letter meta */}
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-sm font-semibold text-slate-800 mb-3">Letter details</div>
          <div className="grid sm:grid-cols-2 gap-3">
            {field("letterDate", "Letter date", { type: "date" })}
            {field("referenceNo", "Reference no.", { placeholder: "e.g. BSO/HR/2026/014" })}
          </div>
        </div>

        {error && (
          <div role="alert" className="text-sm bg-red-50 border border-red-100 text-red-800 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={busy}
            className="text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md px-4 py-2.5 disabled:opacity-40"
          >
            {busy ? "Generating…" : "Generate offer letter + agreement"}
          </button>
          <span className="text-xs text-slate-400">Opens two tabs (offer letter, agreement), each with Download PDF / Print.</span>
        </div>
      </form>
    </div>
  );
}

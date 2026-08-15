"use client";

import { useEffect, useState } from "react";

// HR — Offer Letter generator. Fill the form (or pick an existing employee to
// prefill), click Generate: the complete Offer Letter + Employment & Data
// Protection Agreement opens as a print-perfect A4 document in a new tab with
// a "Download PDF / Print" button (the browser's print-to-PDF — real
// letterhead, colours and the highlighted data-theft clause preserved). Print
// it, get the employee's and HR's physical signatures. Admin/HR only.

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
  candidateAddress: "",
  candidatePhone: "",
  candidateEmail: "",
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
  hrSignatoryName: "",
  hrSignatoryTitle: "Human Resources",
};
type Form = typeof EMPTY;

export default function OfferLetterPage() {
  const [form, setForm] = useState<Form>(EMPTY);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [prefillId, setPrefillId] = useState("");
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
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Could not generate (${res.status})`);
        return;
      }
      const html = await res.text();
      // Open the finished document in its own tab (about:blank + document.write
      // keeps it same-origin so the page's own Print button works).
      const w = window.open("", "_blank");
      if (!w) {
        setError("Your browser blocked the new tab. Allow pop-ups for this site and try again.");
        return;
      }
      w.document.open();
      w.document.write(html);
      w.document.close();
    } catch {
      setError("Could not generate the offer letter. Check your connection and try again.");
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
          Generate an Offer of Employment together with the Employment &amp; Data Protection Agreement on the company
          letterhead. It opens as a print-ready document — click <b>Download PDF / Print</b> there, then collect the
          employee’s and HR’s signatures.
        </p>
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

        {/* Candidate */}
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-sm font-semibold text-slate-800 mb-3">Candidate</div>
          <div className="grid sm:grid-cols-2 gap-3">
            {field("candidateName", "Full name", { required: true, placeholder: "e.g. Rahul Sharma" })}
            {field("candidatePhone", "Phone", { placeholder: "+91 …" })}
            {field("candidateEmail", "Email", { type: "email" })}
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
            <div className="grid grid-cols-[90px_1fr] gap-2 sm:col-span-1">
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
            {field("hrSignatoryName", "Signed by (name)", { placeholder: "e.g. HR Manager’s name" })}
            {field("hrSignatoryTitle", "Signatory title", { placeholder: "Human Resources" })}
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
            {busy ? "Generating…" : "Generate offer letter"}
          </button>
          <span className="text-xs text-slate-400">Opens in a new tab with a Download PDF / Print button.</span>
        </div>
      </form>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Field, PageHeader, StatusBadge } from "@/components/hr/shared";

type Detail = { employeeCode: string; firstName: string; lastName: string | null; preferredName: string | null; email: string; phone: string | null; employmentStatus: string; departmentName: string | null; designationTitle: string | null; employmentTypeName: string | null; managerName: string | null; joiningDate: string | null; dateOfBirth: string | null; workLocation: string | null };

export default function MyHRProfilePage() {
  const [d, setD] = useState<Detail | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    // ?self=1 returns the caller's own profile (the [id] segment is ignored).
    fetch("/api/hr/employees/self?self=1").then(async (r) => {
      if (r.ok) setD((await r.json()).employee);
      else setNotFound(true);
    });
  }, []);

  if (notFound) return <div className="p-6"><PageHeader title="My Profile" /><p className="text-sm text-slate-400">You don&apos;t have an HR profile yet. Ask your HR admin to set one up.</p></div>;
  if (!d) return <div className="p-6 text-sm text-slate-400">Loading…</div>;

  return (
    <div className="p-6 max-w-2xl">
      <PageHeader title="My Profile" subtitle="Your employee record. Contact HR to update it." />
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-base font-semibold text-slate-900">{[d.firstName, d.lastName].filter(Boolean).join(" ")}</div>
            <div className="text-xs text-slate-400">{d.employeeCode} · {d.email}</div>
          </div>
          <StatusBadge status={d.employmentStatus} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Preferred name" value={d.preferredName} />
          <Field label="Phone" value={d.phone} />
          <Field label="Department" value={d.departmentName} />
          <Field label="Designation" value={d.designationTitle} />
          <Field label="Employment type" value={d.employmentTypeName} />
          <Field label="Reports to" value={d.managerName} />
          <Field label="Joining date" value={d.joiningDate} />
          <Field label="Work location" value={d.workLocation} />
        </div>
      </div>
    </div>
  );
}

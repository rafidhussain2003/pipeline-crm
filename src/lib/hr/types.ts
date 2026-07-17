// Phase 22 — HR shared types.
export class HRError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export const EMPLOYMENT_STATUSES = ["active", "probation", "on_notice", "inactive", "terminated"] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];
// Which statuses count an employee as currently working (dashboard "active").
export const ACTIVE_STATUSES: EmploymentStatus[] = ["active", "probation", "on_notice"];

export const DOCUMENT_TYPES = ["offer_letter", "employment_contract", "id_document", "certificate", "other"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export function isValidDateStr(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
}

export function validateCode(code: string, label = "Code"): string {
  const c = (code ?? "").trim();
  if (!/^[0-9A-Za-z.\-_]{1,40}$/.test(c)) throw new HRError(`${label} must be 1-40 characters (letters, digits, dot, dash, underscore)`);
  return c;
}

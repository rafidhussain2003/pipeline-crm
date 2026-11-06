// E-Sign — shared client constants.
export type FieldType = "signature" | "initials" | "date" | "text" | "checkbox";
export const FIELD_LABEL: Record<FieldType, string> = { signature: "Signature", initials: "Initials", date: "Date signed", text: "Text", checkbox: "Checkbox" };
// Default sizes as fractions of page width/height (Letter/A4 portrait).
export const FIELD_DEFAULT: Record<FieldType, { w: number; h: number }> = {
  signature: { w: 0.24, h: 0.055 },
  initials: { w: 0.09, h: 0.045 },
  date: { w: 0.15, h: 0.032 },
  text: { w: 0.24, h: 0.032 },
  checkbox: { w: 0.028, h: 0.022 },
};
export const STATUS_STYLE: Record<string, string> = {
  draft: "text-slate-600 bg-slate-100", sent: "text-blue-700 bg-blue-50", completed: "text-emerald-700 bg-emerald-50", voided: "text-red-700 bg-red-50",
  pending: "text-slate-600 bg-slate-100", viewed: "text-amber-700 bg-amber-50", signed: "text-emerald-700 bg-emerald-50", declined: "text-red-700 bg-red-50",
};
export const fmtWhen = (v: string | Date | null | undefined) => (v ? new Date(v).toLocaleString() : "—");

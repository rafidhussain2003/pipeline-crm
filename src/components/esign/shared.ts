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
// What the admin can place. Every preset is one of the five stored field
// types; Name/Title/Company/Email are long text boxes with a preset label
// (the signer types into them inline, like DocuSign's text tabs).
export type FieldPreset = { key: string; type: FieldType; label: string | null; w: number; h: number; hint: string };
export const FIELD_PRESETS: FieldPreset[] = [
  { key: "signature", type: "signature", label: null, w: 0.24, h: 0.055, hint: "Draw, type or upload — stamped like DocuSign" },
  { key: "initials", type: "initials", label: null, w: 0.09, h: 0.045, hint: "Small initials box" },
  { key: "date", type: "date", label: null, w: 0.15, h: 0.032, hint: "Filled with the signing date" },
  { key: "name", type: "text", label: "Name", w: 0.3, h: 0.032, hint: "Pre-filled with the signer's name" },
  { key: "title", type: "text", label: "Title", w: 0.3, h: 0.032, hint: "Job title" },
  { key: "company", type: "text", label: "Company", w: 0.3, h: 0.032, hint: "Company name" },
  { key: "email", type: "text", label: "Email", w: 0.3, h: 0.032, hint: "Pre-filled with the signer's email" },
  { key: "text", type: "text", label: null, w: 0.3, h: 0.032, hint: "Blank long box with your own label" },
  { key: "checkbox", type: "checkbox", label: null, w: 0.028, h: 0.022, hint: "Tick box" },
];
export const PRESET_LABEL: Record<string, string> = { signature: "Signature", initials: "Initials", date: "Date signed", name: "Name", title: "Title", company: "Company", email: "Email", text: "Text box", checkbox: "Checkbox" };
export const fieldCaption = (f: { type: FieldType; label?: string | null }) => f.label || FIELD_LABEL[f.type];

// DocuSign-style stamp around an applied signature: the caption above, the
// signature, and a 15-character signature ID below. The ID is derived from
// the signer's record so the web view and the signed PDF agree.
export const STAMP_COLOR = "#2b5fbd";
export const stampIdFor = (signerId: string) => signerId.replace(/-/g, "").slice(0, 15).toUpperCase();

// Text boxes whose label names the signer's own details start pre-filled.
export function autofillFor(label: string | null | undefined, signer: { name: string; email: string }): string | null {
  const l = (label || "").trim().toLowerCase();
  if (/^(full |your )?name$/.test(l) || l === "signer name" || l === "printed name") return signer.name;
  if (/^(your )?e-?mail( address)?$/.test(l)) return signer.email;
  return null;
}

export const STATUS_STYLE: Record<string, string> = {
  draft: "text-slate-600 bg-slate-100", sent: "text-blue-700 bg-blue-50", completed: "text-emerald-700 bg-emerald-50", voided: "text-red-700 bg-red-50",
  pending: "text-slate-600 bg-slate-100", viewed: "text-amber-700 bg-amber-50", signed: "text-emerald-700 bg-emerald-50", declined: "text-red-700 bg-red-50",
};
export const fmtWhen = (v: string | Date | null | undefined) => (v ? new Date(v).toLocaleString() : "—");

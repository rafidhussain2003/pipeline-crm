// Sales Ledger — shared vocabulary.

// Activation statuses. A plain string set (not a pg enum) so admins can add
// custom statuses later without a migration. Each maps to a row color in the UI.
export const SALE_STATUSES = ["active", "pending", "cancelled", "follow_up"] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

export function isSaleStatus(s: unknown): s is SaleStatus {
  return typeof s === "string" && (SALE_STATUSES as readonly string[]).includes(s);
}

// The columns an agent/admin may edit inline (never id/companyId/agentId/
// saleMonth via the cell editor — those are set by the server / dedicated flows).
export const EDITABLE_FIELDS = [
  "orderDate",
  "installationDate",
  "customerName",
  "phone",
  "product",
  "autopay",
  "isCommercial",
  "activationStatus",
  "notes",
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

export function isEditableField(k: unknown): k is EditableField {
  return typeof k === "string" && (EDITABLE_FIELDS as readonly string[]).includes(k);
}

// 'YYYY-MM'
export function isValidSaleMonth(m: unknown): m is string {
  return typeof m === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
}

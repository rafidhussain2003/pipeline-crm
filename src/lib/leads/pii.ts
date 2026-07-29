// Lead PII masking — the ONE place that decides what a privacy-restricted role
// may see of a customer, and how the rest is hidden. Applied on the BACKEND at
// every endpoint that returns lead data, so a masked role can never receive
// customer PII no matter how the request is crafted (the UI hiding it is only
// a courtesy on top of this).
//
// Today the only masked role is the Lead Distribution Manager
// (lead_distributor): they see enough to DISTRIBUTE a lead (masked name,
// last-4 phone, form/source/state/disposition/priority/owner/timestamps) but
// can never identify or contact the customer (real name, full phone, email,
// address, notes, attachments, any other PII are hidden). Admins, managers and
// agents are unaffected.

/** Roles whose lead views must have customer PII masked on the backend. */
export function shouldMaskLeadPII(role: string | null | undefined): boolean {
  return role === "lead_distributor";
}

/**
 * The customer-name replacement a masked role sees: the lead's DISTRIBUTION
 * STATE, never the real name. Unassigned → "Fresh Lead"; assigned → "Assigned
 * Lead".
 */
export function maskedLeadName(ownerId: string | null | undefined): string {
  return ownerId ? "Assigned Lead" : "Fresh Lead";
}

/**
 * Phone masked to the last four digits only, e.g. "•••••••4521" — enough to
 * reference a lead in conversation, never enough to dial it. Returns null for
 * a missing phone (nothing to reference).
 */
export function maskPhoneLast4(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 0) return null;
  const last4 = digits.slice(-4);
  return "•••••••" + last4;
}

// The shape every lead-list row must satisfy for masking — a structural subset
// so this helper works for the list route without importing its exact type.
export type MaskableLead = {
  name: string | null;
  phone: string | null;
  email: string | null;
  ownerId: string | null;
  [key: string]: unknown;
};

/**
 * Return a copy of a lead-list row with customer PII masked for a restricted
 * role: name → Fresh/Assigned Lead, phone → last-4, email → null. Everything
 * else the distributor is allowed to see (disposition, priority, form, source,
 * state, owner name, timestamps, duplicate flag) is left untouched. Callers
 * apply this ONLY when shouldMaskLeadPII(role) is true.
 */
export function maskLeadRow<T extends MaskableLead>(lead: T): T {
  return {
    ...lead,
    name: maskedLeadName(lead.ownerId),
    phone: maskPhoneLast4(lead.phone),
    email: null,
  };
}

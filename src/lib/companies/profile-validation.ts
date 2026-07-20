// Phase 4A — validation for the Platform Owner's company-profile edits.
//
// Kept out of the route so the rules are stated once and can be unit-checked
// directly. Scope is strictly COMPANY attributes: this module never touches a
// user, a login email, or a credential.
//
// Every field is optional — a PATCH carries only what changed — but a field
// that IS present must be valid. Blank clears an optional field to NULL rather
// than storing "", so "unset" is one condition everywhere instead of two.

// Deliberately permissive rather than a full RFC 5322 parser: the job is to
// catch typos ("john@", "acme.com") without rejecting addresses real companies
// actually use.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const LIMITS = {
  name: 255,
  supportEmail: 255,
  businessPhone: 50,
  address: 500,
  website: 255,
  timezone: 100,
} as const;

export type CompanyProfileResult =
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; error: string };

export function validateCompanyProfile(body: Record<string, unknown>): CompanyProfileResult {
  const values: Record<string, unknown> = {};

  // Name is the one REQUIRED field — a company with no name is unidentifiable
  // in every list that shows it. Present-but-blank is rejected; absent is fine.
  if ("name" in body) {
    const v = body.name;
    if (typeof v !== "string") return { ok: false, error: "Company name must be text." };
    const name = v.trim();
    if (!name) return { ok: false, error: "Company name is required." };
    if (name.length > LIMITS.name) return { ok: false, error: `Company name must be ${LIMITS.name} characters or fewer.` };
    values.name = name;
  }

  if ("supportEmail" in body) {
    const v = body.supportEmail;
    if (v !== null && typeof v !== "string") return { ok: false, error: "Contact email must be text." };
    const email = typeof v === "string" ? v.trim() : "";
    if (!email) values.supportEmail = null;
    else if (!EMAIL.test(email)) return { ok: false, error: "Enter a valid contact email address." };
    else if (email.length > LIMITS.supportEmail) return { ok: false, error: `Contact email must be ${LIMITS.supportEmail} characters or fewer.` };
    else values.supportEmail = email;
  }

  const optionalText = (
    key: "businessPhone" | "address" | "website" | "timezone",
    label: string
  ): CompanyProfileResult | null => {
    if (!(key in body)) return null;
    const v = body[key];
    if (v !== null && typeof v !== "string") return { ok: false, error: `${label} must be text.` };
    const text = typeof v === "string" ? v.trim() : "";
    if (!text) {
      values[key] = null;
      return null;
    }
    if (text.length > LIMITS[key]) return { ok: false, error: `${label} must be ${LIMITS[key]} characters or fewer.` };
    values[key] = text;
    return null;
  };

  for (const [key, label] of [
    ["businessPhone", "Business phone"],
    ["address", "Address"],
    ["website", "Website"],
    ["timezone", "Timezone"],
  ] as const) {
    const err = optionalText(key, label);
    if (err) return err;
  }

  return { ok: true, values };
}

/**
 * Field-level diff for the audit trail — only what actually CHANGED, with both
 * sides. An audit entry listing every column on every save would bury the one
 * field that moved.
 */
export function diffCompanyFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown>,
  keys: string[]
): { changed: string[]; before: Record<string, unknown>; after: Record<string, unknown> } {
  const changed: string[] = [];
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of keys) {
    const bv = before?.[k] ?? null;
    const av = after[k] ?? null;
    if (JSON.stringify(bv) !== JSON.stringify(av)) {
      changed.push(k);
      b[k] = bv;
      a[k] = av;
    }
  }
  return { changed, before: b, after: a };
}

// Stabilization Phase 1 — one place that decides how a raw inbound field
// becomes a storable lead field, so a lead behaves identically no matter which
// entry point it arrived through (manual API, CSV import, website form,
// webhook, Facebook, retry).
//
// Before this, each path did its own thing: the manual API passed req.json()
// values straight into the insert, so a non-string field or a value longer than
// the column produced a raw Postgres error surfaced as a 500, and a missing
// name stored NULL while every other path stored "Unknown".

// Column widths from the `leads` table — keep in sync with db/schema.ts.
export const LEAD_FIELD_LIMITS = { name: 255, phone: 50, email: 255, disposition: 100, state: 100 } as const;

/**
 * Coerce one inbound value into a safe, storable string (or null).
 *
 * Lenient by design: a lead is revenue, so a slightly malformed field must
 * never cost the whole lead. Numbers/booleans are stringified (a phone sent as
 * a JSON number is common), objects/arrays are dropped rather than stringified
 * into "[object Object]", whitespace is trimmed, empty becomes null, and
 * anything longer than the column is truncated instead of throwing.
 */
export function coerceLeadText(value: unknown, max: number): string | null {
  let v = value;
  if (v == null) return null;
  if (typeof v === "number" || typeof v === "boolean") v = String(v);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

export interface NormalizedLeadInput {
  name: string | null;
  phone: string | null;
  email: string | null;
  disposition: string | null;
}

/** Normalize the four fields every entry point shares. */
export function normalizeLeadInput(raw: {
  name?: unknown; phone?: unknown; email?: unknown; disposition?: unknown;
}): NormalizedLeadInput {
  return {
    name: coerceLeadText(raw.name, LEAD_FIELD_LIMITS.name),
    phone: coerceLeadText(raw.phone, LEAD_FIELD_LIMITS.phone),
    email: coerceLeadText(raw.email, LEAD_FIELD_LIMITS.email),
    disposition: coerceLeadText(raw.disposition, LEAD_FIELD_LIMITS.disposition),
  };
}

/**
 * A lead with no name, no phone and no email is not a lead — it's an empty
 * submission (or a probe). Every path rejects/skips it rather than storing an
 * unusable row that an agent can never action.
 */
export function hasIdentifyingField(input: NormalizedLeadInput): boolean {
  return !!(input.name || input.phone || input.email);
}

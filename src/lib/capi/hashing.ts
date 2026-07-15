// Phase 11 — Meta Conversions API customer-data hashing. Meta requires PII to
// be NORMALIZED (lowercase, trimmed, punctuation/space rules per field) then
// SHA-256 hashed before it leaves our servers. Non-PII match signals
// (client IP, user agent, fbp, fbc) are sent in the clear, as Meta expects.
// The output of buildUserData() is the ONLY representation of a lead's PII that
// is ever stored on a capi_events row — the raw values never are.
import crypto from "crypto";

function sha256(v: string): string {
  return crypto.createHash("sha256").update(v, "utf8").digest("hex");
}

// ── Per-field normalization (Meta's rules) ──────────────────────────────────
const normEmail = (v: string) => v.trim().toLowerCase();
const normPhone = (v: string) => v.replace(/[^0-9]/g, ""); // digits only, keep country code
const normName = (v: string) => v.trim().toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const normCity = (v: string) => v.trim().toLowerCase().replace(/[^a-z]/g, "");
const normState = (v: string) => v.trim().toLowerCase().replace(/[^a-z]/g, ""); // 2-letter code if the CRM stores one
const normZip = (v: string) => v.trim().toLowerCase().replace(/\s/g, "");
const normCountry = (v: string) => v.trim().toLowerCase().replace(/[^a-z]/g, "").slice(0, 2);

function hashField(raw: string | null | undefined, normalize: (v: string) => string): string[] | null {
  if (!raw) return null;
  const n = normalize(String(raw));
  if (!n) return null;
  return [sha256(n)];
}

export interface RawPii {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
  externalId?: string | null; // hashed
  clientIp?: string | null; // not hashed
  userAgent?: string | null; // not hashed
  fbp?: string | null; // not hashed
  fbc?: string | null; // not hashed
}

// Meta user_data object (hashed fields are arrays of hex sha256; the rest are
// sent verbatim). Also returns which match keys were populated, for EMQ.
export function buildUserData(pii: RawPii): { userData: Record<string, unknown>; matchKeys: string[] } {
  const ud: Record<string, unknown> = {};
  const keys: string[] = [];
  const set = (key: string, val: string[] | string | null) => {
    if (val && (Array.isArray(val) ? val.length : true)) {
      ud[key] = val;
      keys.push(key);
    }
  };

  set("em", hashField(pii.email, normEmail));
  set("ph", hashField(pii.phone, normPhone));
  set("fn", hashField(pii.firstName, normName));
  set("ln", hashField(pii.lastName, normName));
  set("ct", hashField(pii.city, normCity));
  set("st", hashField(pii.state, normState));
  set("zp", hashField(pii.zip, normZip));
  set("country", hashField(pii.country, normCountry));
  // external_id is hashed too (Meta recommends it, improves match rate).
  if (pii.externalId) set("external_id", [sha256(String(pii.externalId).trim().toLowerCase())]);
  // Non-hashed signals.
  if (pii.clientIp) set("client_ip_address", pii.clientIp);
  if (pii.userAgent) set("client_user_agent", pii.userAgent);
  if (pii.fbp) set("fbp", pii.fbp);
  if (pii.fbc) set("fbc", pii.fbc);

  return { userData: ud, matchKeys: keys };
}

// Split a full name into first/last for the fn/ln match params.
export function splitName(name: string | null | undefined): { firstName: string | null; lastName: string | null } {
  if (!name || !name.trim()) return { firstName: null, lastName: null };
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export { sha256 };

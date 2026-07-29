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

import { db } from "@/db";
import { companies } from "@/db/schema";
import { eq } from "drizzle-orm";
import { cache } from "@/lib/infra/cache";
import { isUndefinedColumn } from "@/lib/db-errors";

/**
 * Whether a role's lead view must be PII-masked, GIVEN the company's Manager
 * Privacy Mode. Only the Lead Distribution Manager is ever masked, and only
 * while privacy mode is ON. Privacy mode OFF ⇒ the role sees full leads like a
 * trusted operational manager. Pure — the caller supplies the flag.
 */
export function shouldMaskLeadPII(role: string | null | undefined, privacyModeEnabled: boolean): boolean {
  return role === "lead_distributor" && privacyModeEnabled;
}

/**
 * Manager Privacy Mode for a company (cached, 30s — same as the other
 * per-company settings). Defaults to ON (the secure default) if the row or the
 * column (migration 0046) isn't there yet, so masking is never accidentally
 * disabled by a missing setting.
 */
export async function getManagerPrivacyMode(companyId: string): Promise<boolean> {
  return cache.getOrSet(`manager-privacy-mode:${companyId}`, 30_000, async () => {
    try {
      const [row] = await db.select({ v: companies.managerPrivacyMode }).from(companies).where(eq(companies.id, companyId)).limit(1);
      return row?.v ?? true;
    } catch (err) {
      if (isUndefinedColumn(err)) {
        console.error("[pii] manager_privacy_mode column missing (migration 0046 pending) — defaulting privacy ON");
        return true;
      }
      throw err;
    }
  });
}

/**
 * The async convenience every lead-data endpoint uses: is THIS session's lead
 * view masked? Short-circuits to false for any non-distributor (no DB read),
 * so admins/managers/agents are entirely unaffected; only a distributor
 * triggers the (cached) privacy-mode lookup.
 */
export async function leadPIIMaskedFor(role: string | null | undefined, companyId: string): Promise<boolean> {
  if (role !== "lead_distributor") return false;
  return getManagerPrivacyMode(companyId);
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

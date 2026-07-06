import { db } from "@/db";
import { companies, leads, users } from "@/db/schema";
import { and, count, eq, isNull } from "drizzle-orm";

// Plan-based limits, computed from the existing companies.plan field — no
// schema change needed for this. "Storage limits" and "feature flags" are
// intentionally NOT implemented here: there's no file-upload feature to
// measure storage against (attachments are external URLs, see
// leads/[id]/attachments/route.ts's own comment on this), and no
// feature-flag storage exists on companies yet. Both need a product
// decision on what they'd actually gate before they're worth building.
const AGENT_LIMITS: Record<string, number> = {
  starter: 10,
  growth: 50,
  scale: 250,
};
const DEFAULT_AGENT_LIMIT = 10;

const LEAD_LIMITS: Record<string, number> = {
  starter: 5_000,
  growth: 50_000,
  scale: 500_000,
};
const DEFAULT_LEAD_LIMIT = 5_000;

// Soft warning kicks in this far into the limit; hard limit blocks at 100%.
const WARNING_THRESHOLD = 0.9;

export type QuotaCheck = {
  allowed: boolean;
  limit: number;
  current: number;
  warning: string | null;
};

function evaluate(current: number, limit: number, label: string): QuotaCheck {
  if (current >= limit) {
    return { allowed: false, limit, current, warning: `${label} limit reached (${current}/${limit})` };
  }
  if (current >= limit * WARNING_THRESHOLD) {
    return { allowed: true, limit, current, warning: `Approaching ${label.toLowerCase()} limit (${current}/${limit})` };
  }
  return { allowed: true, limit, current, warning: null };
}

export async function checkAgentQuota(companyId: string): Promise<QuotaCheck> {
  const [company] = await db.select({ plan: companies.plan }).from(companies).where(eq(companies.id, companyId)).limit(1);
  const limit = AGENT_LIMITS[company?.plan || ""] ?? DEFAULT_AGENT_LIMIT;

  const [{ value: current }] = await db
    .select({ value: count() })
    .from(users)
    .where(and(eq(users.companyId, companyId), eq(users.role, "agent"), isNull(users.deletedAt)));

  return evaluate(current, limit, "Agent");
}

export async function checkLeadQuota(companyId: string): Promise<QuotaCheck> {
  const [company] = await db.select({ plan: companies.plan }).from(companies).where(eq(companies.id, companyId)).limit(1);
  const limit = LEAD_LIMITS[company?.plan || ""] ?? DEFAULT_LEAD_LIMIT;

  const [{ value: current }] = await db
    .select({ value: count() })
    .from(leads)
    .where(and(eq(leads.companyId, companyId), isNull(leads.deletedAt)));

  return evaluate(current, limit, "Lead");
}

// Phase 13 — seat-based subscription plans. Three tiers priced per active
// agent/month. Billing quantity = purchased seats; usage = count of ACTIVE
// company members (suspended agents don't consume a seat). Stripe-ready: the
// per-plan price + quantity map directly onto a Stripe metered/quantity
// subscription line — this file is the single source of truth for pricing.
import { db } from "@/db";
import { users } from "@/db/schema";
import { and, count, eq, isNull } from "drizzle-orm";
import { daysRemaining } from "./billing";

export type PlanId = "basic" | "professional" | "premium";

export interface Plan {
  id: PlanId;
  label: string;
  pricePerAgentCents: number;
  features: string[];
}

export const PLANS: Record<PlanId, Plan> = {
  basic: { id: "basic", label: "Basic", pricePerAgentCents: 600, features: ["Lead management", "Facebook Lead Ads", "Website Forms", "Auto-assignment"] },
  professional: { id: "professional", label: "Professional", pricePerAgentCents: 900, features: ["Everything in Basic", "AI assignment + insights", "Conversions API", "Operations Center"] },
  premium: { id: "premium", label: "Premium", pricePerAgentCents: 1200, features: ["Everything in Professional", "Priority support", "Advanced routing (skills/SLA)", "Historical import + resend"] },
};

// Legacy plan values (starter/growth/scale) and anything unknown map to Basic.
export function normalizePlan(plan: string | null | undefined): PlanId {
  if (plan === "basic" || plan === "professional" || plan === "premium") return plan;
  if (plan === "growth") return "professional";
  if (plan === "scale") return "premium";
  return "basic";
}

export function planPriceCents(plan: string | null | undefined): number {
  return PLANS[normalizePlan(plan)].pricePerAgentCents;
}

// Monthly total for a plan at a given seat count.
export function monthlyTotalCents(plan: string | null | undefined, seats: number): number {
  return planPriceCents(plan) * Math.max(0, seats);
}

// Active company members (admins/managers/agents) — the seats actually in use.
export async function getActiveAgentCount(companyId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.companyId, companyId), eq(users.active, true), isNull(users.deletedAt)));
  return Number(row?.n ?? 0);
}

export interface SeatUsage {
  seats: number; // purchased
  activeAgents: number; // consuming a seat
  overage: number; // active beyond purchased seats
}

export async function getSeatUsage(companyId: string, purchasedSeats: number): Promise<SeatUsage> {
  const activeAgents = await getActiveAgentCount(companyId);
  return { seats: purchasedSeats, activeAgents, overage: Math.max(0, activeAgents - purchasedSeats) };
}

// Trial countdown warning level for the banner/notifications.
export type TrialWarning = { level: "none" | "info" | "3days" | "1day" | "expired"; daysRemaining: number };

export function trialWarning(company: { subscriptionStatus: string; trialEndsAt: Date | null }): TrialWarning {
  if (company.subscriptionStatus !== "trial" || !company.trialEndsAt) return { level: "none", daysRemaining: 0 };
  const days = daysRemaining(company.trialEndsAt);
  if (company.trialEndsAt.getTime() < Date.now()) return { level: "expired", daysRemaining: 0 };
  if (days <= 1) return { level: "1day", daysRemaining: days };
  if (days <= 3) return { level: "3days", daysRemaining: days };
  return { level: "info", daysRemaining: days };
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

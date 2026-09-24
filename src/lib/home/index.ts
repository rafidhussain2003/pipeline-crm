// My Home — personal home-building budget tracker. Lives in the Finance
// section (admin + finance_employee) but is NOT company finance: nothing here
// touches accounts, journals, or the ledger. Plain rows, plain arithmetic.
import { db } from "@/db";
import { homeBudgets, homeExpenses } from "@/db/schema";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireFinance } from "@/lib/finance/guard";
import type { CompanySession } from "@/lib/auth";

// Who may use My Home: the company admin and Finance Employees — exactly the
// people who keep the books. requireFinance already applies the session,
// feature and module gates; this only narrows the role. A finance_employee
// needs no specific capability (My Home is outside the capability matrix).
export async function requireHome(): Promise<{ ok: true; session: CompanySession } | { ok: false; response: NextResponse }> {
  const auth = await requireFinance("finance:view");
  if (!auth.ok) return auth;
  if (auth.session.role !== "admin" && auth.session.role !== "finance_employee") {
    return { ok: false, response: NextResponse.json({ error: "My Home is available to admins and finance employees only." }, { status: 403 }) };
  }
  return auth;
}

export type HomeExpense = { id: string; amountCents: number; note: string; spentOn: string; createdAt: Date };
export type HomeSummary = { totalCents: number; spentCents: number; leftCents: number; expenses: HomeExpense[] };

export async function getHomeSummary(companyId: string): Promise<HomeSummary> {
  const [[budget], expenses, [spent]] = await Promise.all([
    db.select({ totalCents: homeBudgets.totalCents }).from(homeBudgets).where(eq(homeBudgets.companyId, companyId)).limit(1),
    db
      .select({ id: homeExpenses.id, amountCents: homeExpenses.amountCents, note: homeExpenses.note, spentOn: homeExpenses.spentOn, createdAt: homeExpenses.createdAt })
      .from(homeExpenses)
      .where(and(eq(homeExpenses.companyId, companyId), isNull(homeExpenses.deletedAt)))
      .orderBy(desc(homeExpenses.spentOn), desc(homeExpenses.createdAt)),
    db
      .select({ sum: sql<number>`coalesce(sum(${homeExpenses.amountCents}), 0)::bigint` })
      .from(homeExpenses)
      .where(and(eq(homeExpenses.companyId, companyId), isNull(homeExpenses.deletedAt))),
  ]);
  const totalCents = budget?.totalCents ?? 0;
  const spentCents = Number(spent?.sum ?? 0);
  return { totalCents, spentCents, leftCents: totalCents - spentCents, expenses };
}

// Money comes in as a decimal string/number from the form; store integer cents.
// Rejects NaN, negatives, and absurd values so a typo can't poison the totals.
export function toCents(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n < 0 || n > 1e12) return null;
  return Math.round(n * 100);
}

export async function setHomeBudget(companyId: string, userId: string, totalCents: number) {
  await db
    .insert(homeBudgets)
    .values({ companyId, totalCents, updatedBy: userId })
    .onConflictDoUpdate({ target: homeBudgets.companyId, set: { totalCents, updatedBy: userId, updatedAt: new Date() } });
}

export async function addHomeExpense(companyId: string, userId: string, input: { amountCents: number; note: string; spentOn: string }) {
  const [row] = await db
    .insert(homeExpenses)
    .values({ companyId, amountCents: input.amountCents, note: input.note, spentOn: input.spentOn, createdBy: userId })
    .returning({ id: homeExpenses.id });
  return row;
}

export async function removeHomeExpense(companyId: string, id: string): Promise<boolean> {
  const rows = await db
    .update(homeExpenses)
    .set({ deletedAt: new Date() })
    .where(and(eq(homeExpenses.id, id), eq(homeExpenses.companyId, companyId), isNull(homeExpenses.deletedAt)))
    .returning({ id: homeExpenses.id });
  return rows.length > 0;
}

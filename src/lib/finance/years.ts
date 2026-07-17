// Phase 19 — Financial years: open/close + the posting lock on closed periods.
import { db } from "@/db";
import { financeYears } from "@/db/schema";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { FinanceError, isValidDateString, todayDate } from "./types";

export async function listYears(companyId: string) {
  const rows = await db.select().from(financeYears).where(eq(financeYears.companyId, companyId)).orderBy(asc(financeYears.startDate));
  const today = todayDate();
  return rows.map((y) => ({
    ...y,
    isCurrent: y.status === "open" && y.startDate <= today && y.endDate >= today,
    isFuture: y.startDate > today,
  }));
}

export async function createYear(companyId: string, actorUserId: string, input: { label: string; startDate: string; endDate: string }) {
  if (!input.label?.trim()) throw new FinanceError("A label is required (e.g. FY 2026)");
  if (!isValidDateString(input.startDate) || !isValidDateString(input.endDate)) throw new FinanceError("Valid start and end dates are required");
  if (input.startDate >= input.endDate) throw new FinanceError("The start date must be before the end date");

  // Years may not overlap — a date must belong to at most one year.
  const [overlap] = await db
    .select({ id: financeYears.id, label: financeYears.label })
    .from(financeYears)
    .where(and(eq(financeYears.companyId, companyId), lte(financeYears.startDate, input.endDate), gte(financeYears.endDate, input.startDate)))
    .limit(1);
  if (overlap) throw new FinanceError(`This range overlaps "${overlap.label}"`);

  try {
    const [row] = await db.insert(financeYears).values({ companyId, label: input.label.trim(), startDate: input.startDate, endDate: input.endDate }).returning();
    await recordAudit({ companyId, userId: actorUserId, action: "finance.year_created", entityType: "finance_year", entityId: row.id, after: { label: row.label, startDate: row.startDate, endDate: row.endDate } });
    return row;
  } catch (err) {
    // drizzle wraps the pg error: the constraint name lives on err.cause.
    const text = err instanceof Error ? `${err.message} ${(err.cause as Error | undefined)?.message ?? ""}` : "";
    if (/finance_years_company_label_uniq|duplicate key/.test(text)) throw new FinanceError(`A financial year named "${input.label}" already exists`);
    throw err;
  }
}

export async function setYearStatus(companyId: string, actorUserId: string, yearId: string, status: "open" | "closed") {
  const [year] = await db.select().from(financeYears).where(and(eq(financeYears.id, yearId), eq(financeYears.companyId, companyId))).limit(1);
  if (!year) throw new FinanceError("Financial year not found", 404);
  if (year.status === status) return year;

  const [row] = await db
    .update(financeYears)
    .set({ status, closedAt: status === "closed" ? new Date() : null, closedBy: status === "closed" ? actorUserId : null, updatedAt: new Date() })
    .where(eq(financeYears.id, yearId))
    .returning();
  await recordAudit({
    companyId,
    userId: actorUserId,
    action: status === "closed" ? "finance.year_closed" : "finance.year_reopened",
    entityType: "finance_year",
    entityId: yearId,
    before: { status: year.status },
    after: { status },
  });
  return row;
}

// The posting gate: an entry date inside a CLOSED year is locked history.
// A date no year covers is allowed — year discipline applies once the company
// defines its calendar (documented on the schema).
export async function assertDatePostable(companyId: string, entryDate: string): Promise<void> {
  const [closed] = await db
    .select({ label: financeYears.label })
    .from(financeYears)
    .where(
      and(
        eq(financeYears.companyId, companyId),
        eq(financeYears.status, sql`'closed'::finance_year_status`),
        lte(financeYears.startDate, entryDate),
        gte(financeYears.endDate, entryDate),
      ),
    )
    .limit(1);
  if (closed) throw new FinanceError(`${entryDate} falls in "${closed.label}", which is closed. Reopen the year or use a date in an open period.`);
}

// Phase 21 — payroll dashboard aggregates.
import { db } from "@/db";
import { payrollProfiles, payrollRuns, users } from "@/db/schema";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { getPayrollSettings } from "./settings";

export async function payrollDashboard(companyId: string) {
  const settings = await getPayrollSettings(companyId);

  const [employees] = await db
    .select({ n: count() })
    .from(payrollProfiles)
    .where(and(eq(payrollProfiles.companyId, companyId), eq(payrollProfiles.status, "active")));

  const [activeStaff] = await db
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.companyId, companyId), eq(users.active, true), isNull(users.deletedAt)));

  // Status rollups + money totals over recent runs.
  const runRows = await db
    .select({ status: payrollRuns.status, gross: payrollRuns.totalGrossCents, net: payrollRuns.totalNetCents })
    .from(payrollRuns)
    .where(eq(payrollRuns.companyId, companyId));

  const byStatus = (s: string) => runRows.filter((r) => r.status === s).length;
  const totalGrossCents = runRows.filter((r) => r.status !== "draft").reduce((a, r) => a + r.gross, 0);
  const totalNetCents = runRows.filter((r) => r.status !== "draft").reduce((a, r) => a + r.net, 0);

  // The current period run + the most recent one.
  const [latest] = await db.select().from(payrollRuns).where(eq(payrollRuns.companyId, companyId)).orderBy(desc(payrollRuns.periodStart), desc(payrollRuns.createdAt)).limit(1);

  // Upcoming payroll date = the configured pay day this/next month.
  const now = new Date();
  const day = settings.payDayOfMonth;
  let upcoming = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day));
  if (upcoming < now) upcoming = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, day));

  return {
    currentPeriod: latest ? { label: latest.label, start: latest.periodStart, end: latest.periodEnd, status: latest.status } : null,
    employees: employees.n,
    activeStaff: activeStaff.n,
    unconfiguredStaff: Math.max(0, activeStaff.n - employees.n),
    pendingPayroll: byStatus("draft") + byStatus("calculated"),
    processedPayroll: byStatus("approved") + byStatus("locked"),
    paidPayroll: byStatus("paid"),
    pendingApprovals: byStatus("calculated"),
    totalGrossCents,
    totalNetCents,
    upcomingPayrollDate: upcoming.toISOString().slice(0, 10),
  };
}

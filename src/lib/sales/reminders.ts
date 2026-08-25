// Sales Ledger V2 — installation reminders (DB side).
//
// Reminders are generated EVENT-DRIVEN at write time (when a sale's
// installationDate is set/changed), never by scanning the whole sales table on
// a timer. For each sale whose free-text installationDate parses to a real
// calendar date we precompute two reminder rows — two days before, and on the
// day — each with an indexed dueAt. The daily dashboard reads them directly;
// a cron backstop turns a due reminder into an in-app notification.
//
// The pure parsing + timing + copy lives in ./parse-date (unit-tested there);
// it is re-exported here so existing import sites (`@/lib/sales/reminders`)
// are unchanged.
import { db } from "@/db";
import { sales, salesReminders } from "@/db/schema";
import { and, asc, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { computeDueAts, parseInstallationDate, type ReminderKind } from "./parse-date";

export { REMINDER_COPY, parseInstallationDate, computeDueAts } from "./parse-date";
export type { ReminderKind } from "./parse-date";

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// Reconcile a sale's reminders to its (parsed) installation datetime. Pending
// reminders are cleared and re-created; completed/dismissed ones are left in
// place as history. Only reminders whose dueAt is today-or-later are created,
// so a back-dated / already-past installation never spams stale reminders.
// Auto-creation is audited (spec: "Reminder automatically created").
export async function syncSaleReminders(params: {
  saleId: string;
  companyId: string;
  agentId: string;
  installationAt: Date | null;
  actorUserId: string | null;
}): Promise<void> {
  // Clear existing PENDING reminders (history rows keep their status).
  await db
    .delete(salesReminders)
    .where(and(eq(salesReminders.saleId, params.saleId), eq(salesReminders.status, "pending")));

  if (!params.installationAt) return;

  const due = computeDueAts(params.installationAt);
  const today0 = startOfToday();
  const toCreate = (Object.keys(due) as ReminderKind[])
    .filter((kind) => due[kind] >= today0)
    .map((kind) => ({
      saleId: params.saleId,
      companyId: params.companyId,
      agentId: params.agentId,
      kind,
      dueAt: due[kind],
      status: "pending" as const,
    }));

  if (toCreate.length === 0) return;
  await db.insert(salesReminders).values(toCreate);

  await recordAudit({
    companyId: params.companyId,
    userId: params.actorUserId,
    action: "sale.reminder_created",
    entityType: "sale",
    entityId: params.saleId,
    metadata: {
      installationAt: params.installationAt.toISOString(),
      kinds: toCreate.map((r) => r.kind),
      count: toCreate.length,
    },
  });
}

// One-time backfill / self-heal. A sale can carry a free-text installationDate
// whose parsed installationAt is NULL — either it was entered before the parser
// understood that shape, or the shape genuinely isn't a date. Such rows never
// surfaced on the dashboard and never generated reminders. This walks them once
// (keyset by id, so each row is visited exactly once: rows that now parse leave
// the predicate as they're fixed, and rows that still don't are simply stepped
// over), re-derives installationAt, and for any that now parse sets it and
// (re)creates the reminders. Bounded + idempotent, so it's safe to run on every
// boot; genuinely unparseable rows just cost one visit and are left as-is.
export async function reconcileInstallationDates(
  opts: { batchSize?: number; maxRows?: number } = {}
): Promise<{ scanned: number; fixed: number }> {
  const batchSize = opts.batchSize ?? 500;
  const maxRows = opts.maxRows ?? 50_000;
  let cursor = "00000000-0000-0000-0000-000000000000";
  let scanned = 0;
  let fixed = 0;

  while (scanned < maxRows) {
    const batch = await db
      .select({
        id: sales.id,
        companyId: sales.companyId,
        agentId: sales.agentId,
        installationDate: sales.installationDate,
      })
      .from(sales)
      .where(
        and(
          isNotNull(sales.installationDate),
          isNull(sales.installationAt),
          isNull(sales.deletedAt),
          gt(sales.id, cursor)
        )
      )
      .orderBy(asc(sales.id))
      .limit(batchSize);

    if (batch.length === 0) break;

    for (const row of batch) {
      scanned++;
      const installationAt = parseInstallationDate(row.installationDate);
      if (!installationAt) continue;
      await db.update(sales).set({ installationAt, updatedAt: new Date() }).where(eq(sales.id, row.id));
      await syncSaleReminders({
        saleId: row.id,
        companyId: row.companyId,
        agentId: row.agentId,
        installationAt,
        actorUserId: null,
      });
      fixed++;
    }

    cursor = batch[batch.length - 1].id;
    if (batch.length < batchSize) break;
  }

  return { scanned, fixed };
}

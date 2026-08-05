// Sales Ledger V2 — installation reminders.
//
// Reminders are generated EVENT-DRIVEN at write time (when a sale's
// installationDate is set/changed), never by scanning the whole sales table on
// a timer. For each sale whose free-text installationDate parses to a real
// calendar date we precompute two reminder rows — two days before, and on the
// day — each with an indexed dueAt. The daily dashboard reads them directly;
// a cron backstop turns a due reminder into an in-app notification.
import { db } from "@/db";
import { salesReminders } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";

export type ReminderKind = "before_2d" | "day_of";

// The exact agent-facing copy for each reminder (dashboard + notification).
export const REMINDER_COPY: Record<ReminderKind, { title: string; body: string }> = {
  before_2d: {
    title: "Installation in 2 days",
    body: "Customer installation is in 2 days. Please call the customer and confirm the appointment.",
  },
  day_of: {
    title: "Installation today",
    body: "Customer installation is scheduled for today.",
  },
};

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function makeLocalDate(y: number, mo: number, d: number): Date | null {
  // 09:00 local — a morning nudge, and a stable time the "day_of"/"before_2d"
  // dueAts derive from. Reject impossible dates (e.g. 31 Feb) via round-trip.
  const dt = new Date(y, mo, d, 9, 0, 0, 0);
  if (Number.isNaN(dt.getTime()) || dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) return null;
  return dt;
}

// Best-effort parse of the FREE-TEXT installation date into a real datetime.
// Deliberately conservative: it recognises the common, unambiguous shapes
// ("05 Aug 2026", "5 August 2026", "Aug 5, 2026", "2026-08-05") and returns
// null for anything else ("TBD", "Delivery", a bare "Morning") — a null just
// means "no reminders for this row", never a wrong date. Ambiguous numeric
// slash formats (05/08/2026) are intentionally NOT guessed.
export function parseInstallationDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  // ISO: YYYY-MM-DD
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return makeLocalDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  // DD Mon YYYY  ("10 Aug 2026", "5 August 2026")
  m = s.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})\b/);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase().slice(0, 3)];
    if (mo !== undefined) return makeLocalDate(Number(m[3]), mo, Number(m[1]));
  }

  // Mon DD, YYYY  ("Aug 10, 2026", "August 5 2026")
  m = s.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase().slice(0, 3)];
    if (mo !== undefined) return makeLocalDate(Number(m[3]), mo, Number(m[2]));
  }

  return null;
}

// The two reminder times for an installation datetime.
export function computeDueAts(installationAt: Date): Record<ReminderKind, Date> {
  const dayOf = new Date(
    installationAt.getFullYear(),
    installationAt.getMonth(),
    installationAt.getDate(),
    9, 0, 0, 0
  );
  const before = new Date(dayOf);
  before.setDate(before.getDate() - 2);
  return { before_2d: before, day_of: dayOf };
}

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

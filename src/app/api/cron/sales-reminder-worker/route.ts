import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sales, salesReminders } from "@/db/schema";
import { and, asc, eq, isNull, lte } from "drizzle-orm";
import { sendNotification } from "@/lib/notifications/service";
import { REMINDER_COPY, type ReminderKind } from "@/lib/sales/reminders";
import { purgeExpiredSalesTrash } from "@/lib/sales/trash";

// Sales-installation reminder worker. Same external scheduler + CRON_SECRET as
// the callback worker. Reminders are date-triggered: when a precomputed dueAt
// arrives, this turns the reminder into an in-app notification for the assigned
// agent (once — notifiedAt guards against repeats). The dashboard already shows
// due reminders directly, so this is the ACTIVE nudge on top of that.
//
// Efficient by construction: the query hits the (status, due_at) index for
// pending + un-notified + due rows only — never a full sales scan. Bounded per
// tick; a bigger backlog is picked up next tick. Run it a few times a day
// (reminders are day-granular) — e.g. hourly.
export async function POST(req: NextRequest) {
  const providedSecret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || providedSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const due = await db
    .select({
      id: salesReminders.id,
      companyId: salesReminders.companyId,
      agentId: salesReminders.agentId,
      kind: salesReminders.kind,
      customerName: sales.customerName,
    })
    .from(salesReminders)
    .innerJoin(sales, eq(sales.id, salesReminders.saleId))
    .where(
      and(
        eq(salesReminders.status, "pending"),
        isNull(salesReminders.notifiedAt),
        lte(salesReminders.dueAt, now)
      )
    )
    .orderBy(asc(salesReminders.dueAt))
    .limit(500);

  let notified = 0;
  for (const r of due) {
    const copy = REMINDER_COPY[r.kind as ReminderKind];
    // Stamp notifiedAt regardless so an unknown/legacy kind isn't retried forever.
    if (copy) {
      await sendNotification({
        companyId: r.companyId,
        userId: r.agentId,
        type: "sale.installation_reminder",
        title: copy.title,
        body: r.customerName ? `${copy.body} (Customer: ${r.customerName})` : copy.body,
        metadata: { reminderId: r.id, kind: r.kind },
      });
      notified++;
    }
    await db.update(salesReminders).set({ notifiedAt: now, updatedAt: now }).where(eq(salesReminders.id, r.id));
  }

  // Trash retention sweep — hard-deletes sales trashed >30 days ago.
  // Internally throttled to one real sweep per hour, so calling it on every
  // worker tick costs nothing.
  const purged = await purgeExpiredSalesTrash();

  return NextResponse.json({ ok: true, due: due.length, notified, purged });
}

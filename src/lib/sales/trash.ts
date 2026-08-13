// Sales trash bin retention. A deleted sale is soft-deleted (deletedAt) and
// sits in the admin-only Trash view, restorable, for 30 days — then this
// purge hard-deletes it (commercial_sales links and sales_reminders cascade
// via their FKs, so nothing dangles). Called from the sales cron worker every
// tick but throttled in-process to one real sweep per hour: with the
// deleted_at index the check is an index range scan, and day-granular
// retention needs nothing more frequent.
import { db } from "@/db";
import { sales } from "@/db/schema";
import { lt, isNotNull, and } from "drizzle-orm";

export const TRASH_RETENTION_DAYS = 30;
const PURGE_INTERVAL_MS = 60 * 60 * 1000; // one real sweep per hour

let lastPurgeAt = 0;

export async function purgeExpiredSalesTrash(): Promise<number> {
  const now = Date.now();
  if (now - lastPurgeAt < PURGE_INTERVAL_MS) return 0;
  lastPurgeAt = now;

  const cutoff = new Date(now - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const purged = await db
    .delete(sales)
    .where(and(isNotNull(sales.deletedAt), lt(sales.deletedAt, cutoff)))
    .returning({ id: sales.id });
  if (purged.length > 0) {
    console.log(`[sales-trash] purged ${purged.length} sale(s) deleted more than ${TRASH_RETENTION_DAYS} days ago`);
  }
  return purged.length;
}

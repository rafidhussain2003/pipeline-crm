// Finance — one-time data repairs run at boot (idempotent, bounded, audited).
//
// Reversal dating: until this fix, voiding an entry posted its reversal on the
// day of the void instead of the original entry's date, so the month of the
// void showed a negative and the original month stayed overstated (and an
// un-void then double-counted the original month). Existing reversals are
// moved onto their original entry's date — the ledger stays balanced to the
// paisa, only the period attribution changes — unless that date sits in a
// closed financial year, which is left as-is (that is the correct treatment
// for a locked period).
import { db } from "@/db";
import { financeJournalLines, financeJournals } from "@/db/schema";
import { and, asc, eq, gt, isNotNull, ne } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { assertDatePostable } from "./years";

export async function redateReversalsToOriginal(opts: { maxRows?: number } = {}): Promise<{ scanned: number; moved: number }> {
  const maxRows = opts.maxRows ?? 20_000;
  let cursor = "00000000-0000-0000-0000-000000000000";
  let scanned = 0;
  let moved = 0;
  while (scanned < maxRows) {
    const batch = await db
      .select({ id: financeJournals.id, companyId: financeJournals.companyId, entryDate: financeJournals.entryDate, entryNumber: financeJournals.entryNumber, reversalOfId: financeJournals.reversalOfId })
      .from(financeJournals)
      .where(and(eq(financeJournals.sourceType, "reversal"), isNotNull(financeJournals.reversalOfId), gt(financeJournals.id, cursor)))
      .orderBy(asc(financeJournals.id))
      .limit(500);
    if (batch.length === 0) break;
    for (const rev of batch) {
      scanned++;
      const [orig] = await db.select({ entryDate: financeJournals.entryDate }).from(financeJournals).where(eq(financeJournals.id, rev.reversalOfId!)).limit(1);
      if (!orig || orig.entryDate === rev.entryDate) continue;
      try {
        await assertDatePostable(rev.companyId, orig.entryDate);
      } catch {
        continue; // original period is closed — a current-dated reversal is right there
      }
      await db.transaction(async (tx) => {
        await tx.update(financeJournals).set({ entryDate: orig.entryDate, updatedAt: new Date() }).where(and(eq(financeJournals.id, rev.id), ne(financeJournals.entryDate, orig.entryDate)));
        await tx.update(financeJournalLines).set({ entryDate: orig.entryDate }).where(eq(financeJournalLines.journalId, rev.id));
      });
      await recordAudit({ companyId: rev.companyId, userId: null, action: "finance.reversal_redated", entityType: "finance_journal", entityId: rev.id, before: { entryDate: rev.entryDate }, after: { entryDate: orig.entryDate, reason: "reversal now dated on the original entry's date" } });
      moved++;
    }
    cursor = batch[batch.length - 1].id;
    if (batch.length < 500) break;
  }
  return { scanned, moved };
}

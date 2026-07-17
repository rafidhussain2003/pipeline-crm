// Phase 19 — JournalService: the ONLY writer of the double-entry core.
// Everything financial in Ziplod — manual entries, revenue, expenses, opening
// balances, and every future module (Payroll, Inventory, …) — becomes a
// journal through this file, so the invariants live in exactly one place:
//
//   • a journal POSTS only if debits == credits (checked in integer cents)
//   • posted journals are IMMUTABLE — no update or delete path exists;
//     corrections are reversing entries (void) or new adjusting entries
//   • entry numbers are per-company sequential, assigned atomically at post
//   • an entry date inside a closed financial year never posts
import { db } from "@/db";
import { financeAccounts, financeJournalLines, financeJournals, financeSettings } from "@/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { lock } from "@/lib/infra/lock";
import { recordAudit } from "@/lib/audit";
import { FinanceError, isValidDateString, toCents, toMoneyString, todayDate, type JournalLineInput } from "./types";
import { assertDatePostable } from "./years";
import { ensureFinanceSetup } from "./accounts";

const MAX_LINES = 100;

interface NormalizedLine {
  accountId: string;
  debitCents: number;
  creditCents: number;
  description: string | null;
}

// Validate + normalize caller lines: every line one-sided and positive, all
// accounts exist in THIS company and are active, and the entry balances.
async function normalizeLines(companyId: string, lines: JournalLineInput[]): Promise<NormalizedLine[]> {
  if (!Array.isArray(lines) || lines.length < 2) throw new FinanceError("A journal entry needs at least two lines");
  if (lines.length > MAX_LINES) throw new FinanceError(`A journal entry can have at most ${MAX_LINES} lines`);

  const normalized: NormalizedLine[] = lines.map((l) => {
    const debitCents = l.debit !== undefined && l.debit !== null ? toCents(l.debit) : 0;
    const creditCents = l.credit !== undefined && l.credit !== null ? toCents(l.credit) : 0;
    if (debitCents < 0 || creditCents < 0) throw new FinanceError("Debit and credit amounts must be positive");
    if (debitCents > 0 && creditCents > 0) throw new FinanceError("A line can be a debit or a credit, not both");
    if (debitCents === 0 && creditCents === 0) throw new FinanceError("Every line needs a debit or credit amount");
    if (!l.accountId) throw new FinanceError("Every line needs an account");
    return { accountId: l.accountId, debitCents, creditCents, description: l.description?.trim() || null };
  });

  const accountIds = [...new Set(normalized.map((l) => l.accountId))];
  const accounts = await db
    .select({ id: financeAccounts.id, active: financeAccounts.active })
    .from(financeAccounts)
    .where(and(eq(financeAccounts.companyId, companyId), inArray(financeAccounts.id, accountIds)));
  const byId = new Map(accounts.map((a) => [a.id, a]));
  for (const id of accountIds) {
    const acc = byId.get(id);
    if (!acc) throw new FinanceError("One of the accounts does not exist in this company", 404);
    if (!acc.active) throw new FinanceError("One of the accounts is inactive");
  }

  const totalDebit = normalized.reduce((s, l) => s + l.debitCents, 0);
  const totalCredit = normalized.reduce((s, l) => s + l.creditCents, 0);
  if (totalDebit !== totalCredit) {
    throw new FinanceError(`The entry does not balance: debits ${toMoneyString(totalDebit)} vs credits ${toMoneyString(totalCredit)}`);
  }
  if (totalDebit === 0) throw new FinanceError("The entry total cannot be zero");
  return normalized;
}

async function nextEntryNumber(companyId: string): Promise<number> {
  const rows = await db
    .update(financeSettings)
    .set({ nextJournalNumber: sql`${financeSettings.nextJournalNumber} + 1`, updatedAt: new Date() })
    .where(eq(financeSettings.companyId, companyId))
    .returning({ n: financeSettings.nextJournalNumber });
  if (rows.length === 0) {
    await ensureFinanceSetup(companyId);
    return nextEntryNumber(companyId);
  }
  // RETURNING yields the post-increment counter; the number ASSIGNED to this
  // entry is the pre-increment value.
  return rows[0].n - 1;
}

export async function getJournal(companyId: string, journalId: string) {
  const [header] = await db.select().from(financeJournals).where(and(eq(financeJournals.id, journalId), eq(financeJournals.companyId, companyId))).limit(1);
  if (!header) return null;
  const lines = await db
    .select({
      id: financeJournalLines.id,
      accountId: financeJournalLines.accountId,
      lineNo: financeJournalLines.lineNo,
      debit: financeJournalLines.debit,
      credit: financeJournalLines.credit,
      description: financeJournalLines.description,
      accountCode: financeAccounts.code,
      accountName: financeAccounts.name,
    })
    .from(financeJournalLines)
    .innerJoin(financeAccounts, eq(financeAccounts.id, financeJournalLines.accountId))
    .where(eq(financeJournalLines.journalId, journalId))
    .orderBy(financeJournalLines.lineNo);
  return { ...header, lines };
}

export async function listJournals(companyId: string, opts: { status?: "draft" | "posted" | "voided"; limit?: number; offset?: number } = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const where = opts.status
    ? and(eq(financeJournals.companyId, companyId), eq(financeJournals.status, opts.status))
    : eq(financeJournals.companyId, companyId);
  const rows = await db
    .select({
      id: financeJournals.id,
      entryNumber: financeJournals.entryNumber,
      entryDate: financeJournals.entryDate,
      memo: financeJournals.memo,
      status: financeJournals.status,
      sourceType: financeJournals.sourceType,
      reversalOfId: financeJournals.reversalOfId,
      createdAt: financeJournals.createdAt,
      total: sql<string>`(select coalesce(sum(l.debit), 0) from finance_journal_lines l where l.journal_id = ${financeJournals.id})`,
    })
    .from(financeJournals)
    .where(where)
    .orderBy(desc(financeJournals.entryDate), desc(financeJournals.createdAt))
    .limit(limit)
    .offset(offset);
  return rows;
}

export interface CreateJournalInput {
  entryDate: string;
  memo?: string | null;
  lines: JournalLineInput[];
  sourceType?: string;
  sourceId?: string | null;
}

// Create a DRAFT (validated but not in the ledger, editable).
export async function createDraft(companyId: string, actorUserId: string, input: CreateJournalInput) {
  if (!isValidDateString(input.entryDate)) throw new FinanceError("A valid entry date (YYYY-MM-DD) is required");
  const lines = await normalizeLines(companyId, input.lines);

  const journal = await db.transaction(async (tx) => {
    const [header] = await tx
      .insert(financeJournals)
      .values({ companyId, entryDate: input.entryDate, memo: input.memo?.trim() || null, sourceType: input.sourceType ?? "manual", sourceId: input.sourceId ?? null, createdBy: actorUserId })
      .returning();
    await tx.insert(financeJournalLines).values(
      lines.map((l, i) => ({
        journalId: header.id,
        companyId,
        accountId: l.accountId,
        lineNo: i + 1,
        entryDate: input.entryDate,
        posted: false,
        debit: toMoneyString(l.debitCents),
        credit: toMoneyString(l.creditCents),
        description: l.description,
      })),
    );
    return header;
  });
  await recordAudit({ companyId, userId: actorUserId, action: "finance.journal_created", entityType: "finance_journal", entityId: journal.id, after: { entryDate: input.entryDate, lines: input.lines.length, sourceType: journal.sourceType } });
  return journal;
}

// Drafts are editable (replace lines wholesale). Posted/voided are not — that
// is the immutability contract, enforced here and nowhere bypassable.
export async function updateDraft(companyId: string, actorUserId: string, journalId: string, input: { entryDate?: string; memo?: string | null; lines?: JournalLineInput[] }) {
  const [header] = await db.select().from(financeJournals).where(and(eq(financeJournals.id, journalId), eq(financeJournals.companyId, companyId))).limit(1);
  if (!header) throw new FinanceError("Journal entry not found", 404);
  if (header.status !== "draft") throw new FinanceError(`A ${header.status} journal entry cannot be edited. Post an adjusting entry instead.`);

  const entryDate = input.entryDate ?? header.entryDate;
  if (!isValidDateString(entryDate)) throw new FinanceError("A valid entry date (YYYY-MM-DD) is required");
  const lines = input.lines ? await normalizeLines(companyId, input.lines) : null;

  await db.transaction(async (tx) => {
    await tx
      .update(financeJournals)
      .set({ entryDate, memo: input.memo !== undefined ? input.memo?.trim() || null : header.memo, updatedAt: new Date() })
      .where(eq(financeJournals.id, journalId));
    if (lines) {
      await tx.delete(financeJournalLines).where(eq(financeJournalLines.journalId, journalId));
      await tx.insert(financeJournalLines).values(
        lines.map((l, i) => ({
          journalId,
          companyId,
          accountId: l.accountId,
          lineNo: i + 1,
          entryDate,
          posted: false,
          debit: toMoneyString(l.debitCents),
          credit: toMoneyString(l.creditCents),
          description: l.description,
        })),
      );
    } else if (input.entryDate) {
      await tx.update(financeJournalLines).set({ entryDate }).where(eq(financeJournalLines.journalId, journalId));
    }
  });
  await recordAudit({ companyId, userId: actorUserId, action: "finance.journal_updated", entityType: "finance_journal", entityId: journalId, after: { entryDate, linesReplaced: !!lines } });
  return getJournal(companyId, journalId);
}

// POST: draft → ledger. Re-validates balance from the stored lines (never
// trusts what was validated at draft time), checks the financial year, assigns
// the sequential number, and flips the lines' posted flag — all in one
// transaction under the per-company finance lock.
export async function postJournal(companyId: string, actorUserId: string, journalId: string) {
  return lock.withLock(`finance:${companyId}`, async () => {
    const journal = await getJournal(companyId, journalId);
    if (!journal) throw new FinanceError("Journal entry not found", 404);
    if (journal.status !== "draft") throw new FinanceError(`Only draft entries can be posted (this one is ${journal.status})`);

    const totalDebit = journal.lines.reduce((s, l) => s + Math.round(Number(l.debit) * 100), 0);
    const totalCredit = journal.lines.reduce((s, l) => s + Math.round(Number(l.credit) * 100), 0);
    if (journal.lines.length < 2 || totalDebit !== totalCredit || totalDebit === 0) {
      throw new FinanceError("This entry no longer balances and cannot be posted");
    }
    await assertDatePostable(companyId, journal.entryDate);
    const entryNumber = await nextEntryNumber(companyId);

    await db.transaction(async (tx) => {
      await tx
        .update(financeJournals)
        .set({ status: "posted", entryNumber, postedBy: actorUserId, postedAt: new Date(), updatedAt: new Date() })
        .where(eq(financeJournals.id, journalId));
      await tx.update(financeJournalLines).set({ posted: true }).where(eq(financeJournalLines.journalId, journalId));
    });
    await recordAudit({ companyId, userId: actorUserId, action: "finance.journal_posted", entityType: "finance_journal", entityId: journalId, after: { entryNumber, entryDate: journal.entryDate, total: toMoneyString(totalDebit) } });
    return getJournal(companyId, journalId);
  });
}

// Convenience for the modules that post in one step (revenue/expense/opening).
export async function createAndPost(companyId: string, actorUserId: string, input: CreateJournalInput) {
  const draft = await createDraft(companyId, actorUserId, input);
  const posted = await postJournal(companyId, actorUserId, draft.id);
  return posted!;
}

// VOID: the ledger loses nothing. The original stays posted-in-ledger, its
// header is marked voided, and a dated-today REVERSING entry (lines swapped)
// is posted, netting the effect to zero. Voiding an entry whose reversal
// would land in a closed period is rejected by the same year gate as any post.
export async function voidJournal(companyId: string, actorUserId: string, journalId: string, reason?: string) {
  return lock.withLock(`finance:${companyId}`, async () => {
    const journal = await getJournal(companyId, journalId);
    if (!journal) throw new FinanceError("Journal entry not found", 404);
    if (journal.status !== "posted") throw new FinanceError(`Only posted entries can be voided (this one is ${journal.status})`);

    const today = todayDate();
    await assertDatePostable(companyId, today);
    const entryNumber = await nextEntryNumber(companyId);

    const reversal = await db.transaction(async (tx) => {
      const [rev] = await tx
        .insert(financeJournals)
        .values({
          companyId,
          entryNumber,
          entryDate: today,
          memo: `Reversal of JE-${journal.entryNumber}${reason ? ` — ${reason}` : ""}`,
          status: "posted",
          sourceType: "reversal",
          reversalOfId: journal.id,
          createdBy: actorUserId,
          postedBy: actorUserId,
          postedAt: new Date(),
        })
        .returning();
      await tx.insert(financeJournalLines).values(
        journal.lines.map((l, i) => ({
          journalId: rev.id,
          companyId,
          accountId: l.accountId,
          lineNo: i + 1,
          entryDate: today,
          posted: true,
          debit: l.credit, // swapped
          credit: l.debit,
          description: l.description,
        })),
      );
      await tx
        .update(financeJournals)
        .set({ status: "voided", voidedBy: actorUserId, voidedAt: new Date(), voidReason: reason ?? null, updatedAt: new Date() })
        .where(eq(financeJournals.id, journalId));
      return rev;
    });
    await recordAudit({ companyId, userId: actorUserId, action: "finance.journal_voided", entityType: "finance_journal", entityId: journalId, after: { reversalId: reversal.id, reversalNumber: entryNumber, reason: reason ?? null } });
    return { voided: journalId, reversal };
  });
}

// Drafts (only) can be discarded entirely — they were never in the ledger.
export async function deleteDraft(companyId: string, actorUserId: string, journalId: string): Promise<void> {
  const [header] = await db.select().from(financeJournals).where(and(eq(financeJournals.id, journalId), eq(financeJournals.companyId, companyId))).limit(1);
  if (!header) throw new FinanceError("Journal entry not found", 404);
  if (header.status !== "draft") throw new FinanceError("Only draft entries can be deleted — posted history is immutable");
  await db.delete(financeJournals).where(eq(financeJournals.id, journalId)); // lines cascade
  await recordAudit({ companyId, userId: actorUserId, action: "finance.journal_draft_deleted", entityType: "finance_journal", entityId: journalId, before: { entryDate: header.entryDate, memo: header.memo } });
}

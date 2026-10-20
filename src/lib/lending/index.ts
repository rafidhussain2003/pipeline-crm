// Lending Bank — admin-only private lending ledger. Services for the pool
// (funds in/out), loans (disburse → EMI schedule → mark paid → close) and the
// automatic borrower emails. INR only, integer paise, not company finance.
import { db } from "@/db";
import { lendingBanks, lendingEmis, lendingLoans, lendingTransactions, users } from "@/db/schema";
import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireCompanySession, type CompanySession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { lock } from "@/lib/infra/lock";
import { buildSchedule, firstDueDateAfter } from "./emi";
import { sendEmiReceiptEmail, sendEmiReminderEmail, sendLoanDetailsEmail, type EmiForEmail, type LoanForEmail } from "./email";

export class LendingError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}
export function lendingErrorResponse(err: unknown): NextResponse {
  if (err instanceof LendingError) return NextResponse.json({ error: err.message }, { status: err.status });
  throw err;
}

// Admin only — nobody else. Deliberately NOT routed through the Finance
// module's guard: the Lending Bank is the admin's private ledger and works
// whether or not the company has the Finance module, finance capabilities,
// or anything else enabled. The only requirement is a valid session for the
// company's admin.
export async function requireLendingAdmin(): Promise<{ ok: true; session: CompanySession } | { ok: false; response: NextResponse }> {
  const auth = await requireCompanySession();
  if (!auth.ok) return auth;
  if (auth.session.role !== "admin") {
    return { ok: false, response: NextResponse.json({ error: "The Lending Bank is available to the company admin only." }, { status: 403 }) };
  }
  return auth;
}

export function toPaise(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n < 0 || n > 1e10) return null;
  return Math.round(n * 100);
}
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function ensureBank(companyId: string, userId: string) {
  await db.insert(lendingBanks).values({ companyId, createdBy: userId }).onConflictDoNothing();
  const [bank] = await db.select().from(lendingBanks).where(eq(lendingBanks.companyId, companyId)).limit(1);
  return bank;
}

// The lender as the borrower knows them: the admin who runs the bank (the
// person who created it), not the company — this is a personal ledger.
async function lenderName(companyId: string): Promise<string> {
  const [bank] = await db.select({ createdBy: lendingBanks.createdBy }).from(lendingBanks).where(eq(lendingBanks.companyId, companyId)).limit(1);
  if (bank?.createdBy) {
    const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, bank.createdBy)).limit(1);
    if (u?.name) return u.name;
  }
  const [admin] = await db.select({ name: users.name }).from(users).where(and(eq(users.companyId, companyId), eq(users.role, "admin"))).limit(1);
  return admin?.name || "Your lender";
}

// ── Summary ─────────────────────────────────────────────────────────────────
export async function getBankSummary(companyId: string, userId: string) {
  const bank = await ensureBank(companyId, userId);
  const [sums] = await db
    .select({
      deposits: sql<number>`coalesce(sum(case when ${lendingTransactions.kind} = 'deposit' then ${lendingTransactions.amountCents} else 0 end), 0)::bigint`,
      withdrawals: sql<number>`coalesce(sum(case when ${lendingTransactions.kind} = 'withdrawal' then ${lendingTransactions.amountCents} else 0 end), 0)::bigint`,
      disbursed: sql<number>`coalesce(sum(case when ${lendingTransactions.kind} = 'disbursement' then ${lendingTransactions.amountCents} else 0 end), 0)::bigint`,
      repaid: sql<number>`coalesce(sum(case when ${lendingTransactions.kind} = 'repayment' then ${lendingTransactions.amountCents} else 0 end), 0)::bigint`,
    })
    .from(lendingTransactions)
    .where(eq(lendingTransactions.companyId, companyId));
  const [interest] = await db
    .select({ earned: sql<number>`coalesce(sum(${lendingEmis.interestCents}), 0)::bigint` })
    .from(lendingEmis)
    .where(and(eq(lendingEmis.companyId, companyId), eq(lendingEmis.status, "paid")));
  const [outstanding] = await db
    .select({ principal: sql<number>`coalesce(sum(${lendingEmis.principalCents}), 0)::bigint`, count: sql<number>`count(distinct ${lendingEmis.loanId})::int` })
    .from(lendingEmis)
    .innerJoin(lendingLoans, eq(lendingLoans.id, lendingEmis.loanId))
    .where(and(eq(lendingEmis.companyId, companyId), eq(lendingEmis.status, "pending"), eq(lendingLoans.status, "active")));
  const deposits = Number(sums?.deposits ?? 0), withdrawals = Number(sums?.withdrawals ?? 0), disbursed = Number(sums?.disbursed ?? 0), repaid = Number(sums?.repaid ?? 0);
  return {
    defaultInterestRate: Number(bank.defaultInterestRate),
    hasFunds: deposits > 0,
    balanceCents: deposits - withdrawals - disbursed + repaid,
    depositsCents: deposits,
    withdrawalsCents: withdrawals,
    disbursedCents: disbursed,
    repaidCents: repaid,
    outstandingPrincipalCents: Number(outstanding?.principal ?? 0),
    interestEarnedCents: Number(interest?.earned ?? 0),
    activeLoans: Number(outstanding?.count ?? 0),
  };
}

export async function listTransactions(companyId: string, limit = 100) {
  return db
    .select({ id: lendingTransactions.id, kind: lendingTransactions.kind, amountCents: lendingTransactions.amountCents, note: lendingTransactions.note, occurredOn: lendingTransactions.occurredOn, loanId: lendingTransactions.loanId, createdAt: lendingTransactions.createdAt, borrowerName: lendingLoans.borrowerName, loanNumber: lendingLoans.loanNumber })
    .from(lendingTransactions)
    .leftJoin(lendingLoans, eq(lendingLoans.id, lendingTransactions.loanId))
    .where(eq(lendingTransactions.companyId, companyId))
    .orderBy(desc(lendingTransactions.occurredOn), desc(lendingTransactions.createdAt))
    .limit(limit);
}

// ── Funds ───────────────────────────────────────────────────────────────────
export async function addFunds(companyId: string, userId: string, input: { amountCents: number; note?: string | null; occurredOn?: string | null; kind?: "deposit" | "withdrawal" }) {
  const kind = input.kind === "withdrawal" ? "withdrawal" : "deposit";
  if (input.amountCents <= 0) throw new LendingError("Enter an amount greater than zero");
  const occurredOn = input.occurredOn && isDate(input.occurredOn) ? input.occurredOn : today();
  await ensureBank(companyId, userId);
  if (kind === "withdrawal") {
    const s = await getBankSummary(companyId, userId);
    if (input.amountCents > s.balanceCents) throw new LendingError("Not enough balance in the bank to withdraw that much");
  }
  const [row] = await db.insert(lendingTransactions).values({ companyId, kind, amountCents: input.amountCents, note: input.note?.trim().slice(0, 300) || null, occurredOn, createdBy: userId }).returning();
  await recordAudit({ companyId, userId, action: `lending.${kind}`, entityType: "lending_transaction", entityId: row.id, after: { amountCents: input.amountCents, occurredOn } });
  return row;
}

export async function setDefaultRate(companyId: string, userId: string, rate: number) {
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new LendingError("Interest rate must be between 0 and 100");
  await ensureBank(companyId, userId);
  await db.update(lendingBanks).set({ defaultInterestRate: rate.toFixed(2), updatedAt: new Date() }).where(eq(lendingBanks.companyId, companyId));
}

// ── Loans ───────────────────────────────────────────────────────────────────
export interface CreateLoanInput {
  borrowerName: string;
  borrowerPhone: string;
  borrowerEmail: string;
  principalCents: number;
  interestRate?: number | null; // % p.a.; bank default when omitted
  tenureMonths: number; // 1–12
  startDate?: string | null;
  notes?: string | null;
  sendEmail?: boolean;
}

export async function createLoan(companyId: string, userId: string, input: CreateLoanInput) {
  const name = input.borrowerName?.trim().slice(0, 160);
  const phone = input.borrowerPhone?.trim().slice(0, 40);
  const email = input.borrowerEmail?.trim().toLowerCase().slice(0, 200);
  if (!name) throw new LendingError("Borrower name is required");
  if (!phone) throw new LendingError("Borrower phone number is required");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new LendingError("Enter a valid borrower email");
  if (!Number.isInteger(input.principalCents) || input.principalCents <= 0) throw new LendingError("Loan amount must be greater than zero");
  const months = Math.floor(Number(input.tenureMonths));
  if (!Number.isInteger(months) || months < 1 || months > 12) throw new LendingError("Tenure must be between 1 and 12 months");
  const startDate = input.startDate && isDate(input.startDate) ? input.startDate : today();

  return lock.withLock(`lending:${companyId}`, async () => {
    const bank = await ensureBank(companyId, userId);
    const rate = input.interestRate === null || input.interestRate === undefined || input.interestRate === ("" as unknown) ? Number(bank.defaultInterestRate) : Number(input.interestRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new LendingError("Interest rate must be between 0 and 100");
    const summary = await getBankSummary(companyId, userId);
    if (!summary.hasFunds) throw new LendingError("Add the bank's initial balance before giving a loan");
    if (input.principalCents > summary.balanceCents) throw new LendingError("Not enough balance in the bank for this loan. Add funds first.");

    const firstDue = firstDueDateAfter(startDate);
    const schedule = buildSchedule(input.principalCents, rate, months, firstDue);
    const [{ n }] = await db
      .select({ n: sql<number>`coalesce(max(${lendingLoans.loanNumber}), 0)::int + 1` })
      .from(lendingLoans)
      .where(eq(lendingLoans.companyId, companyId));

    const loan = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(lendingLoans)
        .values({
          companyId, loanNumber: Number(n), borrowerName: name, borrowerPhone: phone, borrowerEmail: email,
          principalCents: input.principalCents, interestRate: rate.toFixed(2), tenureMonths: months,
          emiCents: schedule.emiCents, totalInterestCents: schedule.totalInterestCents, totalPayableCents: schedule.totalPayableCents,
          startDate, firstDueDate: firstDue, notes: input.notes?.trim().slice(0, 2000) || null, createdBy: userId,
        })
        .returning();
      await tx.insert(lendingEmis).values(schedule.rows.map((r) => ({ companyId, loanId: row.id, ...r })));
      await tx.insert(lendingTransactions).values({ companyId, kind: "disbursement", amountCents: input.principalCents, loanId: row.id, note: `Loan LN-${row.loanNumber} to ${name}`, occurredOn: startDate, createdBy: userId });
      return row;
    });
    await recordAudit({ companyId, userId, action: "lending.loan_created", entityType: "lending_loan", entityId: loan.id, after: { loanNumber: loan.loanNumber, borrower: name, principalCents: input.principalCents, rate, months, emiCents: schedule.emiCents } });

    let emailResult: { ok: boolean; reason?: string } | null = null;
    if (input.sendEmail !== false) emailResult = await emailLoanDetails(companyId, userId, loan.id);
    return { loan, email: emailResult };
  });
}

export async function getLoan(companyId: string, loanId: string) {
  const [loan] = await db.select().from(lendingLoans).where(and(eq(lendingLoans.id, loanId), eq(lendingLoans.companyId, companyId))).limit(1);
  if (!loan) return null;
  const emis = await db.select().from(lendingEmis).where(eq(lendingEmis.loanId, loanId)).orderBy(asc(lendingEmis.installmentNo));
  return { loan, emis };
}

export async function listLoans(companyId: string) {
  const loans = await db.select().from(lendingLoans).where(eq(lendingLoans.companyId, companyId)).orderBy(desc(lendingLoans.createdAt));
  const stats = await db
    .select({
      loanId: lendingEmis.loanId,
      paidCount: sql<number>`count(*) filter (where ${lendingEmis.status} = 'paid')::int`,
      paidCents: sql<number>`coalesce(sum(${lendingEmis.emiCents}) filter (where ${lendingEmis.status} = 'paid'), 0)::bigint`,
      nextDue: sql<string | null>`min(${lendingEmis.dueDate}) filter (where ${lendingEmis.status} = 'pending')`,
      overdue: sql<number>`count(*) filter (where ${lendingEmis.status} = 'pending' and ${lendingEmis.dueDate} < current_date)::int`,
    })
    .from(lendingEmis)
    .where(eq(lendingEmis.companyId, companyId))
    .groupBy(lendingEmis.loanId);
  const byLoan = new Map(stats.map((s) => [s.loanId, s]));
  return loans.map((l) => {
    const s = byLoan.get(l.id);
    return { ...l, paidCount: Number(s?.paidCount ?? 0), paidCents: Number(s?.paidCents ?? 0), nextDue: s?.nextDue ?? null, overdue: Number(s?.overdue ?? 0) };
  });
}

export async function markEmiPaid(companyId: string, userId: string, loanId: string, emiId: string, input: { paidOn?: string | null; note?: string | null; sendEmail?: boolean }) {
  return lock.withLock(`lending:${companyId}`, async () => {
    const data = await getLoan(companyId, loanId);
    if (!data) throw new LendingError("Loan not found", 404);
    const emi = data.emis.find((e) => e.id === emiId);
    if (!emi) throw new LendingError("EMI not found", 404);
    if (data.loan.status !== "active") throw new LendingError("This loan is not active");
    if (emi.status === "paid") throw new LendingError("This EMI is already marked paid");
    const paidOn = input.paidOn && isDate(input.paidOn) ? input.paidOn : today();

    await db.transaction(async (tx) => {
      await tx.update(lendingEmis).set({ status: "paid", paidOn, paidCents: emi.emiCents, paidNote: input.note?.trim().slice(0, 200) || null }).where(eq(lendingEmis.id, emiId));
      await tx.insert(lendingTransactions).values({ companyId, kind: "repayment", amountCents: emi.emiCents, loanId, emiId, note: `EMI ${emi.installmentNo}/${data.loan.tenureMonths} — LN-${data.loan.loanNumber} ${data.loan.borrowerName}`, occurredOn: paidOn, createdBy: userId });
      const remaining = data.emis.filter((e) => e.id !== emiId && e.status === "pending");
      if (remaining.length === 0) await tx.update(lendingLoans).set({ status: "closed", closedAt: new Date(), updatedAt: new Date() }).where(eq(lendingLoans.id, loanId));
    });
    await recordAudit({ companyId, userId, action: "lending.emi_paid", entityType: "lending_emi", entityId: emiId, after: { loanId, installmentNo: emi.installmentNo, amountCents: emi.emiCents, paidOn } });

    let email: { ok: boolean; reason?: string } | null = null;
    if (input.sendEmail !== false) {
      const remaining = data.emis.filter((e) => e.id !== emiId && e.status === "pending");
      email = await sendEmiReceiptEmail(await lenderName(companyId), data.loan, { ...emi, status: "paid", paidOn }, remaining.reduce((s, e) => s + e.emiCents, 0), remaining.length);
    }
    return { email };
  });
}

// Undo a "paid" mark made by mistake. Removes the repayment from the pool and
// reopens the loan if it had closed.
export async function unmarkEmiPaid(companyId: string, userId: string, loanId: string, emiId: string) {
  return lock.withLock(`lending:${companyId}`, async () => {
    const data = await getLoan(companyId, loanId);
    if (!data) throw new LendingError("Loan not found", 404);
    const emi = data.emis.find((e) => e.id === emiId);
    if (!emi || emi.status !== "paid") throw new LendingError("This EMI is not marked paid");
    await db.transaction(async (tx) => {
      await tx.update(lendingEmis).set({ status: "pending", paidOn: null, paidCents: null, paidNote: null }).where(eq(lendingEmis.id, emiId));
      await tx.delete(lendingTransactions).where(and(eq(lendingTransactions.emiId, emiId), eq(lendingTransactions.kind, "repayment")));
      if (data.loan.status === "closed") await tx.update(lendingLoans).set({ status: "active", closedAt: null, updatedAt: new Date() }).where(eq(lendingLoans.id, loanId));
    });
    await recordAudit({ companyId, userId, action: "lending.emi_unpaid", entityType: "lending_emi", entityId: emiId, after: { loanId, installmentNo: emi.installmentNo } });
  });
}

// Cancel a loan that was never repaid (no EMI paid) — the principal returns
// to the pool. A loan with payments can't be cancelled; it runs to closure.
export async function cancelLoan(companyId: string, userId: string, loanId: string) {
  return lock.withLock(`lending:${companyId}`, async () => {
    const data = await getLoan(companyId, loanId);
    if (!data) throw new LendingError("Loan not found", 404);
    if (data.loan.status !== "active") throw new LendingError("Only an active loan can be cancelled");
    if (data.emis.some((e) => e.status === "paid")) throw new LendingError("This loan already has EMIs paid, so it can't be cancelled");
    await db.transaction(async (tx) => {
      await tx.update(lendingLoans).set({ status: "cancelled", closedAt: new Date(), updatedAt: new Date() }).where(eq(lendingLoans.id, loanId));
      await tx.delete(lendingTransactions).where(and(eq(lendingTransactions.loanId, loanId), eq(lendingTransactions.kind, "disbursement")));
    });
    await recordAudit({ companyId, userId, action: "lending.loan_cancelled", entityType: "lending_loan", entityId: loanId });
  });
}

// ── Emails ──────────────────────────────────────────────────────────────────
function loanForEmail(l: typeof lendingLoans.$inferSelect): LoanForEmail {
  return { loanNumber: l.loanNumber, borrowerName: l.borrowerName, borrowerEmail: l.borrowerEmail, principalCents: l.principalCents, interestRate: l.interestRate, tenureMonths: l.tenureMonths, emiCents: l.emiCents, totalInterestCents: l.totalInterestCents, totalPayableCents: l.totalPayableCents, startDate: l.startDate, firstDueDate: l.firstDueDate };
}
function emiForEmail(e: typeof lendingEmis.$inferSelect): EmiForEmail {
  return { installmentNo: e.installmentNo, dueDate: e.dueDate, emiCents: e.emiCents, principalCents: e.principalCents, interestCents: e.interestCents, balanceAfterCents: e.balanceAfterCents, status: e.status, paidOn: e.paidOn };
}

export async function emailLoanDetails(companyId: string, userId: string, loanId: string): Promise<{ ok: boolean; reason?: string }> {
  const data = await getLoan(companyId, loanId);
  if (!data) throw new LendingError("Loan not found", 404);
  const res = await sendLoanDetailsEmail(await lenderName(companyId), loanForEmail(data.loan), data.emis.map(emiForEmail));
  if (res.ok) await db.update(lendingLoans).set({ lastEmailAt: new Date() }).where(eq(lendingLoans.id, loanId));
  await recordAudit({ companyId, userId, action: "lending.loan_emailed", entityType: "lending_loan", entityId: loanId, after: { ok: res.ok, reason: res.reason ?? null } });
  return res;
}

// Automatic reminders, run from the in-process daily sweep (and safe to run
// more often): one "upcoming" email ~3 days before each due date and one
// "due today" email on the date. Each is sent once (stamped on the EMI).
export async function sendDueEmiReminders(): Promise<{ upcoming: number; due: number }> {
  const t = today();
  const soon = new Date(`${t}T00:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + 3);
  const soonIso = soon.toISOString().slice(0, 10);
  const rows = await db
    .select({ emi: lendingEmis, loan: lendingLoans })
    .from(lendingEmis)
    .innerJoin(lendingLoans, eq(lendingLoans.id, lendingEmis.loanId))
    .where(and(eq(lendingEmis.status, "pending"), eq(lendingLoans.status, "active"), lte(lendingEmis.dueDate, soonIso)))
    .limit(500);
  let upcoming = 0, due = 0;
  const lenderByCompany = new Map<string, string>();
  for (const r of rows) {
    let lender = lenderByCompany.get(r.loan.companyId);
    if (!lender) { lender = await lenderName(r.loan.companyId); lenderByCompany.set(r.loan.companyId, lender); }
    if (r.emi.dueDate <= t) {
      if (!r.emi.dueNoticeSentAt) {
        const res = await sendEmiReminderEmail(lender, loanForEmail(r.loan), emiForEmail(r.emi), "due");
        if (res.ok) { await db.update(lendingEmis).set({ dueNoticeSentAt: new Date() }).where(eq(lendingEmis.id, r.emi.id)); due++; }
      }
    } else if (!r.emi.reminderSentAt) {
      const res = await sendEmiReminderEmail(lender, loanForEmail(r.loan), emiForEmail(r.emi), "upcoming");
      if (res.ok) { await db.update(lendingEmis).set({ reminderSentAt: new Date() }).where(eq(lendingEmis.id, r.emi.id)); upcoming++; }
    }
  }
  return { upcoming, due };
}

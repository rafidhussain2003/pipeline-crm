// Lending Bank — borrower emails: the loan agreement summary with the full
// EMI schedule (sent on disbursement / on demand), a reminder ahead of each
// due date, a notice on the due date, and a receipt when an EMI is marked
// paid. Sent through the existing Resend adapter; without RESEND_API_KEY the
// send is a logged no-op and the caller surfaces the reason.
import { sendViaResend } from "@/lib/mailbox/resend";
import { inrPlain, longDate } from "./emi";

const FROM = process.env.EMAIL_FROM || "Ziplod <noreply@ziplod.com>";

export type LoanForEmail = {
  loanNumber: number; borrowerName: string; borrowerEmail: string; principalCents: number; interestRate: string; tenureMonths: number;
  emiCents: number; totalInterestCents: number; totalPayableCents: number; startDate: string; firstDueDate: string;
};
export type EmiForEmail = { installmentNo: number; dueDate: string; emiCents: number; principalCents: number; interestCents: number; balanceAfterCents: number; status: string; paidOn: string | null };

function shell(title: string, body: string, lender: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px">
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:28px">
      <div style="font-size:18px;font-weight:700;color:#0f172a;margin-bottom:16px">${esc(lender)}</div>
      <h1 style="font-size:18px;color:#0f172a;margin:0 0 12px">${title}</h1>
      ${body}
    </div>
    <p style="text-align:center;color:#94a3b8;font-size:12px;margin-top:16px">This is an automatic message from ${esc(lender)}'s lending records.</p>
  </div></body></html>`;
}
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function kv(rows: [string, string][]): string {
  return `<table style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0">${rows
    .map(([k, v]) => `<tr><td style="padding:6px 0;color:#64748b">${k}</td><td style="padding:6px 0;text-align:right;color:#0f172a;font-weight:600">${v}</td></tr>`)
    .join("")}</table>`;
}
function scheduleTable(emis: EmiForEmail[]): string {
  const head = `<tr style="background:#f8fafc;color:#64748b"><th style="text-align:left;padding:6px 8px">#</th><th style="text-align:left;padding:6px 8px">Due date</th><th style="text-align:right;padding:6px 8px">EMI</th><th style="text-align:right;padding:6px 8px">Principal</th><th style="text-align:right;padding:6px 8px">Interest</th><th style="text-align:right;padding:6px 8px">Balance</th><th style="text-align:left;padding:6px 8px">Status</th></tr>`;
  const rows = emis
    .map((e) => `<tr style="border-top:1px solid #e2e8f0${e.status === "paid" ? ";color:#15803d" : ""}"><td style="padding:6px 8px">${e.installmentNo}</td><td style="padding:6px 8px">${longDate(e.dueDate)}</td><td style="padding:6px 8px;text-align:right;font-weight:600">${inrPlain(e.emiCents)}</td><td style="padding:6px 8px;text-align:right">${inrPlain(e.principalCents)}</td><td style="padding:6px 8px;text-align:right">${inrPlain(e.interestCents)}</td><td style="padding:6px 8px;text-align:right">${inrPlain(e.balanceAfterCents)}</td><td style="padding:6px 8px">${e.status === "paid" ? `Paid${e.paidOn ? ` on ${longDate(e.paidOn)}` : ""}` : "Due"}</td></tr>`)
    .join("");
  return `<table style="width:100%;border-collapse:collapse;font-size:12px;margin:12px 0">${head}${rows}</table>`;
}
function loanSummary(loan: LoanForEmail): string {
  return kv([
    ["Loan reference", `LN-${loan.loanNumber}`],
    ["Loan amount", inrPlain(loan.principalCents)],
    ["Interest rate", `${Number(loan.interestRate)}% per annum (reducing balance)`],
    ["Tenure", `${loan.tenureMonths} month${loan.tenureMonths === 1 ? "" : "s"}`],
    ["Monthly EMI", inrPlain(loan.emiCents)],
    ["Total interest", inrPlain(loan.totalInterestCents)],
    ["Total payable", inrPlain(loan.totalPayableCents)],
    ["Disbursed on", longDate(loan.startDate)],
    ["First EMI due", longDate(loan.firstDueDate)],
  ]);
}

export async function sendLoanDetailsEmail(lender: string, loan: LoanForEmail, emis: EmiForEmail[]): Promise<{ ok: boolean; reason?: string }> {
  const html = shell(
    `Your loan details — LN-${loan.loanNumber}`,
    `<p style="font-size:14px;color:#475569">Hi ${esc(loan.borrowerName)}, here are the details of your loan from ${esc(lender)}. Every EMI is due on the 1st of the month.</p>${loanSummary(loan)}<h2 style="font-size:14px;color:#0f172a;margin:16px 0 4px">EMI schedule</h2>${scheduleTable(emis)}<p style="font-size:12px;color:#94a3b8">Keep this email for your records. You will get a reminder before each due date.</p>`,
    lender
  );
  const text = `Loan LN-${loan.loanNumber} from ${lender}\nAmount: ${inrPlain(loan.principalCents)}\nRate: ${Number(loan.interestRate)}% p.a.\nTenure: ${loan.tenureMonths} months\nEMI: ${inrPlain(loan.emiCents)} due on the 1st of every month, first on ${longDate(loan.firstDueDate)}\nTotal payable: ${inrPlain(loan.totalPayableCents)}\n\nSchedule:\n${emis.map((e) => `${e.installmentNo}. ${longDate(e.dueDate)} — ${inrPlain(e.emiCents)} (${e.status})`).join("\n")}`;
  const res = await sendViaResend({ from: FROM, to: [loan.borrowerEmail], subject: `Your loan details: LN-${loan.loanNumber} — EMI ${inrPlain(loan.emiCents)} on the 1st of every month`, html, text });
  return res.ok ? { ok: true } : { ok: false, reason: res.reason };
}

export async function sendEmiReminderEmail(lender: string, loan: LoanForEmail, emi: EmiForEmail, kind: "upcoming" | "due"): Promise<{ ok: boolean; reason?: string }> {
  const when = kind === "due" ? "is due today" : `is due on ${longDate(emi.dueDate)}`;
  const html = shell(
    kind === "due" ? `EMI due today — ${inrPlain(emi.emiCents)}` : `EMI reminder — ${inrPlain(emi.emiCents)} due ${longDate(emi.dueDate)}`,
    `<p style="font-size:14px;color:#475569">Hi ${esc(loan.borrowerName)}, EMI ${emi.installmentNo} of ${loan.tenureMonths} for your loan LN-${loan.loanNumber} ${when}.</p>${kv([
      ["Amount due", inrPlain(emi.emiCents)],
      ["Due date", longDate(emi.dueDate)],
      ["Of which interest", inrPlain(emi.interestCents)],
      ["Balance after this EMI", inrPlain(emi.balanceAfterCents)],
    ])}<p style="font-size:12px;color:#94a3b8">Please pay ${esc(lender)} by the due date.</p>`,
    lender
  );
  const res = await sendViaResend({ from: FROM, to: [loan.borrowerEmail], subject: `${kind === "due" ? "EMI due today" : "EMI reminder"}: ${inrPlain(emi.emiCents)} for loan LN-${loan.loanNumber}`, html, text: `EMI ${emi.installmentNo}/${loan.tenureMonths} for loan LN-${loan.loanNumber} ${when}: ${inrPlain(emi.emiCents)}.` });
  return res.ok ? { ok: true } : { ok: false, reason: res.reason };
}

export async function sendEmiReceiptEmail(lender: string, loan: LoanForEmail, emi: EmiForEmail, remainingCents: number, remainingCount: number): Promise<{ ok: boolean; reason?: string }> {
  const html = shell(
    `Payment received — EMI ${emi.installmentNo} of ${loan.tenureMonths}`,
    `<p style="font-size:14px;color:#475569">Hi ${esc(loan.borrowerName)}, thank you. Your EMI for loan LN-${loan.loanNumber} has been recorded as paid.</p>${kv([
      ["Amount", inrPlain(emi.paidOn ? emi.emiCents : emi.emiCents)],
      ["Paid on", emi.paidOn ? longDate(emi.paidOn) : "—"],
      ["Outstanding principal", inrPlain(emi.balanceAfterCents)],
      ["EMIs remaining", `${remainingCount} (${inrPlain(remainingCents)})`],
    ])}${remainingCount === 0 ? `<p style="font-size:14px;color:#15803d;font-weight:600">Your loan is fully repaid. Thank you!</p>` : ""}`,
    lender
  );
  const res = await sendViaResend({ from: FROM, to: [loan.borrowerEmail], subject: `Payment received: EMI ${emi.installmentNo}/${loan.tenureMonths} for loan LN-${loan.loanNumber}`, html, text: `EMI ${emi.installmentNo}/${loan.tenureMonths} for loan LN-${loan.loanNumber} recorded as paid (${inrPlain(emi.emiCents)}). EMIs remaining: ${remainingCount}.` });
  return res.ok ? { ok: true } : { ok: false, reason: res.reason };
}

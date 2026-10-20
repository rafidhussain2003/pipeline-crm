// Lending Bank — EMI mathematics. Standard reducing-balance EMI (what every
// fintech lending app uses): a fixed monthly instalment whose interest part
// falls and principal part rises each month. All money is integer paise.
//
//   r   = annual rate / 12 / 100
//   EMI = P · r · (1+r)^n / ((1+r)^n − 1)      (r = 0 → P / n)
//
// The schedule is rounded per instalment; the LAST instalment absorbs the
// rounding so the balance lands on exactly zero.
export type ScheduleRow = { installmentNo: number; dueDate: string; emiCents: number; principalCents: number; interestCents: number; balanceAfterCents: number };

export function monthlyEmiCents(principalCents: number, annualRatePct: number, months: number): number {
  const r = annualRatePct / 12 / 100;
  if (r === 0) return Math.round(principalCents / months);
  const f = Math.pow(1 + r, months);
  return Math.round((principalCents * r * f) / (f - 1));
}

// The 1st of the month after `startDate` — EMIs are always due on the 1st.
export function firstDueDateAfter(startDate: string): string {
  const y = Number(startDate.slice(0, 4));
  const m = Number(startDate.slice(5, 7));
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-01`;
}

export function addMonthsToFirst(firstDue: string, k: number): string {
  const y = Number(firstDue.slice(0, 4));
  const m = Number(firstDue.slice(5, 7)) - 1 + k;
  return `${y + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}-01`;
}

export function buildSchedule(principalCents: number, annualRatePct: number, months: number, firstDue: string): { emiCents: number; totalInterestCents: number; totalPayableCents: number; rows: ScheduleRow[] } {
  const emi = monthlyEmiCents(principalCents, annualRatePct, months);
  const r = annualRatePct / 12 / 100;
  const rows: ScheduleRow[] = [];
  let balance = principalCents;
  let totalInterest = 0;
  for (let i = 1; i <= months; i++) {
    const interest = Math.round(balance * r);
    let principal = emi - interest;
    let instalment = emi;
    if (i === months || principal > balance) {
      principal = balance; // clear whatever is left
      instalment = principal + interest;
    }
    balance -= principal;
    totalInterest += interest;
    rows.push({ installmentNo: i, dueDate: addMonthsToFirst(firstDue, i - 1), emiCents: instalment, principalCents: principal, interestCents: interest, balanceAfterCents: balance });
  }
  return { emiCents: emi, totalInterestCents: totalInterest, totalPayableCents: principalCents + totalInterest, rows };
}

export function inr(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}₹${(Math.abs(cents) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function inrPlain(cents: number): string {
  return `INR ${(Math.abs(cents) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function longDate(iso: string): string {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)), d = Number(iso.slice(8, 10));
  return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : iso;
}

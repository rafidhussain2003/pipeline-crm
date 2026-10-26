/* Sales Ledger — installation-date parser regression suite.
 * Run: npm run test:sales   (tsx; no framework). This is the single point of
 * failure for the daily dashboard + installation reminders: if a real-world
 * date shape stops parsing, installs silently stop surfacing. `ref` is pinned
 * so year-inference is deterministic.  Pretend "now" = Tue 25 Aug 2026. */
import { parseInstallationDate, computeDueAts, parseOrderDate, localMidnightUtc } from "./parse-date";

let pass = 0;
const fails: string[] = [];
const ck = (n: string, c: boolean) => { if (c) pass++; else fails.push(n); };

const REF = new Date(2026, 7, 25, 10, 0, 0); // Aug 25 2026, mid-morning

// A parsed installation date is always local 09:00 on the intended y/m/d.
const is = (raw: string, y: number, mo: number, d: number) => {
  const dt = parseInstallationDate(raw, REF);
  return !!dt && dt.getFullYear() === y && dt.getMonth() === mo && dt.getDate() === d && dt.getHours() === 9;
};

// ── Numeric, US month-first (what agents actually type) ──
ck("8/27/2026", is("8/27/2026", 2026, 7, 27));
ck("08/27/2026", is("08/27/2026", 2026, 7, 27));
ck("08/27/26 (2-digit year)", is("08/27/26", 2026, 7, 27));
ck("8-27-2026 (dashes)", is("8-27-2026", 2026, 7, 27));
ck("8.27.2026 (dots)", is("8.27.2026", 2026, 7, 27));
ck("9/10 (no year → this year)", is("9/10", 2026, 8, 10));
ck("8/27 (no year → this year)", is("8/27", 2026, 7, 27));
ck("12/31 (year-end)", is("12/31", 2026, 11, 31));
ck("13/5 (day-first slip → 13 May)", is("13/5/2026", 2026, 4, 13));

// ── ISO / year-first ──
ck("2026-08-27 (ISO)", is("2026-08-27", 2026, 7, 27));
ck("2026/8/27 (year-first slash)", is("2026/8/27", 2026, 7, 27));

// ── Month name, either order, year optional, ordinals, qualifiers ──
ck("Aug 27, 2026", is("Aug 27, 2026", 2026, 7, 27));
ck("August 27 2026", is("August 27 2026", 2026, 7, 27));
ck("27 Aug 2026", is("27 Aug 2026", 2026, 7, 27));
ck("27 August 2026", is("27 August 2026", 2026, 7, 27));
ck("Sept 3 2026 (4-letter month)", is("Sept 3 2026", 2026, 8, 3));
ck("Aug 27 (no year)", is("Aug 27", 2026, 7, 27));
ck("27 Aug (no year)", is("27 Aug", 2026, 7, 27));
ck("Aug 27th 2026 (ordinal)", is("Aug 27th 2026", 2026, 7, 27));
ck("Aug 27 Morning (trailing qualifier)", is("Aug 27 Morning", 2026, 7, 27));
ck("8/27 PM (trailing qualifier)", is("8/27 PM", 2026, 7, 27));
ck("Delivery 27 Aug 2026 (leading non-month word)", is("Delivery 27 Aug 2026", 2026, 7, 27));

// ── Year inference rolls a far-past year-less date forward (installs look ahead) ──
ck("Jan 3 (far past → next year)", is("Jan 3", 2027, 0, 3));
ck("1/3 (far past → next year)", is("1/3", 2027, 0, 3));
ck("Dec 20 (future this year)", is("Dec 20", 2026, 11, 20));

// ── Never emit a WRONG date: genuine non-dates & impossibles → null ──
const isNull = (raw: string) => parseInstallationDate(raw, REF) === null;
ck("TBD → null", isNull("TBD"));
ck("Delivery → null", isNull("Delivery"));
ck("Stream → null", isNull("Stream"));
ck("Morning → null", isNull("Morning"));
ck("empty → null", isNull(""));
ck("whitespace → null", isNull("   "));
ck("null input → null", parseInstallationDate(null, REF) === null);
ck("undefined input → null", parseInstallationDate(undefined, REF) === null);
ck("2/31/2026 (impossible day) → null", isNull("2/31/2026"));
ck("13/13/2026 (no valid month) → null", isNull("13/13/2026"));
ck("Feb 30 2026 (impossible) → null", isNull("Feb 30 2026"));
ck("phone-like 555-1234 → null", isNull("555-1234"));
ck("bare year 2026 → null", isNull("2026"));
ck("count '2 boxes' → null", isNull("2 boxes"));

// ── Reminder timing derives 2-days-before + day-of at 09:00 ──
{
  const inst = parseInstallationDate("Aug 27 2026", REF)!;
  const due = computeDueAts(inst);
  const at = (dt: Date, y: number, mo: number, d: number) => dt.getFullYear() === y && dt.getMonth() === mo && dt.getDate() === d && dt.getHours() === 9;
  ck("dueAt day_of = install day 09:00", at(due.day_of, 2026, 7, 27));
  ck("dueAt before_2d = 2 days before 09:00", at(due.before_2d, 2026, 7, 25));
}

// ── Order date: free text → calendar date, disambiguated by the sheet month ──
{
  const od = (raw: string, month: string) => parseOrderDate(raw, month);
  ck("order 5/10/2026 in Oct sheet → 5 Oct (day-first)", od("5/10/2026", "2026-10") === "2026-10-05");
  ck("order 10/5/2026 in Oct sheet → 5 Oct (month-first)", od("10/5/2026", "2026-10") === "2026-10-05");
  ck("order 2/10/2026 in Oct sheet → 2 Oct", od("2/10/2026", "2026-10") === "2026-10-02");
  ck("order 14/10/2026 (unambiguous) → 14 Oct", od("14/10/2026", "2026-10") === "2026-10-14");
  ck("order 10/14/2026 (unambiguous US) → 14 Oct", od("10/14/2026", "2026-10") === "2026-10-14");
  ck("order 23/10/26 (2-digit year)", od("23/10/26", "2026-10") === "2026-10-23");
  ck("order 5/10 (no year) in Oct sheet → 5 Oct 2026", od("5/10", "2026-10") === "2026-10-05");
  ck("order 7 oct 2026", od("7 oct 2026", "2026-10") === "2026-10-07");
  ck("order Oct 7", od("Oct 7", "2026-10") === "2026-10-07");
  ck("order 2026-10-07 (ISO)", od("2026-10-07", "2026-10") === "2026-10-07");
  ck("order 30/9/2026 in Oct sheet (late Sept sale) → 30 Sep", od("30/9/2026", "2026-10") === "2026-09-30");
  ck("order 9/30 in Oct sheet → 30 Sep (only valid reading)", od("9/30", "2026-10") === "2026-09-30");
  ck("order 5/8 in Aug sheet → 5 Aug (nearest to sheet)", od("5/8", "2026-08") === "2026-08-05");
  ck("order 8/5 in Aug sheet → 5 Aug", od("8/5", "2026-08") === "2026-08-05");
  ck("order 3/6/2026 in May sheet (neither reads May) → nearest month, 3 Jun", od("3/6/2026", "2026-05") === "2026-06-03");
  ck("order 3/6/2026 in Mar sheet → 6 Mar", od("3/6/2026", "2026-03") === "2026-03-06");
  ck("order 3/6/2026 in Jun sheet → 3 Jun", od("3/6/2026", "2026-06") === "2026-06-03");
  ck("order Dec 30 in Jan 2027 sheet → 30 Dec 2026", od("Dec 30", "2027-01") === "2026-12-30");
  ck("order 'na' → null", od("na", "2026-10") === null);
  ck("order 'TBD' → null", od("TBD", "2026-10") === null);
  ck("order '' → null", od("", "2026-10") === null);
  ck("order 31/9/2026 (impossible) → null", od("31/9/2026", "2026-10") === null);
  // Timezone boundary for the createdAt fallback.
  ck("local midnight 5 Oct IST = 4 Oct 18:30 UTC", localMidnightUtc("2026-10-05", "Asia/Kolkata").toISOString() === "2026-10-04T18:30:00.000Z");
  ck("local midnight 5 Oct UTC", localMidnightUtc("2026-10-05", "UTC").toISOString() === "2026-10-05T00:00:00.000Z");
  ck("local midnight 5 Oct New York (EDT) = 04:00 UTC", localMidnightUtc("2026-10-05", "America/New_York").toISOString() === "2026-10-05T04:00:00.000Z");
  ck("unknown zone → UTC", localMidnightUtc("2026-10-05", "Nowhere/Land").toISOString() === "2026-10-05T00:00:00.000Z");
}

console.log(`\nSales parse-date suite: ${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log("  FAIL: " + f); process.exit(1); }
console.log("ALL PASS");

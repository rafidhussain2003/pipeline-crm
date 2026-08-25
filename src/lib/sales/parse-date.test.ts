/* Sales Ledger — installation-date parser regression suite.
 * Run: npm run test:sales   (tsx; no framework). This is the single point of
 * failure for the daily dashboard + installation reminders: if a real-world
 * date shape stops parsing, installs silently stop surfacing. `ref` is pinned
 * so year-inference is deterministic.  Pretend "now" = Tue 25 Aug 2026. */
import { parseInstallationDate, computeDueAts } from "./parse-date";

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

console.log(`\nSales parse-date suite: ${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log("  FAIL: " + f); process.exit(1); }
console.log("ALL PASS");

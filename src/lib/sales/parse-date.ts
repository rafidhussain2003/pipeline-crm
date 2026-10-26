// Sales Ledger — PURE installation-date parsing + reminder copy/timing (no I/O),
// so the exact policy that lights up the daily dashboard and the installation
// reminders is unit-testable and identical on every code path. The DB-touching
// side (syncSaleReminders / reconcileInstallationDates) lives in reminders.ts,
// which re-exports everything here so existing import sites are unchanged.

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

// Year for a year-less date ("8/27", "Aug 27"). Installations look FORWARD, so
// we take the current year unless that lands well in the past (more than a
// ~6-month grace before `ref`), in which case we roll to next year. The grace
// keeps a recently-passed date in the current year rather than pushing every
// slightly-late entry twelve months out.
function inferYear(mo: number, d: number, ref: Date): number {
  const y = ref.getFullYear();
  const candidate = new Date(y, mo, d, 9, 0, 0, 0);
  const graceMs = 183 * 24 * 60 * 60 * 1000;
  return candidate.getTime() < ref.getTime() - graceMs ? y + 1 : y;
}

// Best-effort parse of the FREE-TEXT installation date into a real datetime.
// This is what feeds the dashboard + reminders, so it recognises the shapes a
// call-center agent actually types — not only fully written-out dates:
//   • numeric, US month-first: "8/27", "8/27/2026", "08/27/26", "8-27-2026", "8.27"
//   • ISO / year-first:        "2026-08-27", "2026/8/27"
//   • month name, either order, year optional, ordinals + trailing qualifiers ok:
//                              "Aug 27", "Aug 27th, 2026", "27 August 2026", "Aug 27 Morning"
// A year may be omitted (inferred forward). It still returns null for genuine
// non-dates ("TBD", "Delivery", "Stream", a bare "Morning") — a null just means
// "no reminders for this row", never a wrong date. `ref` (defaults to now)
// anchors year inference and is injectable so the behaviour is deterministically
// testable.
export function parseInstallationDate(raw: string | null | undefined, ref: Date = new Date()): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  // Year-first ISO / numeric: YYYY-MM-DD, YYYY/M/D, YYYY.M.D
  const iso = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return makeLocalDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  // Month name + day, EITHER order, year optional, ordinal suffix tolerated.
  // The month token must be an actual month name (not any word), so a leading
  // non-month word ("Delivery 27 Aug 2026") never captures the day and blocks
  // the real match; matchAll then returns the first valid pairing.
  const MON = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
  const monthRe = new RegExp(
    `\\b${MON}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(\\d{4}))?\\b|\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MON}\\.?(?:\\s*,?\\s*(\\d{4}))?\\b`,
    "gi"
  );
  for (const m of s.matchAll(monthRe)) {
    const name = m[1] ?? m[5];
    const dayStr = m[2] ?? m[4];
    if (!name || dayStr === undefined) continue;
    const mo = MONTHS[name.toLowerCase().slice(0, 3)];
    if (mo === undefined) continue;
    const d = Number(dayStr);
    const yStr = m[3] ?? m[6];
    const y = yStr ? Number(yStr) : inferYear(mo, d, ref);
    const dt = makeLocalDate(y, mo, d);
    if (dt) return dt;
  }

  // Numeric, month-first (US): M/D, M/D/YY, M/D/YYYY with / - or . separators.
  const num = s.match(/\b(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?\b/);
  if (num) {
    let mo = Number(num[1]);
    let d = Number(num[2]);
    // Tolerate an unambiguous day-first slip ("13/5" → 13 May).
    if (mo > 12 && d <= 12) [mo, d] = [d, mo];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    let y: number;
    if (num[3]) {
      const yy = Number(num[3]);
      y = yy < 100 ? 2000 + yy : yy;
    } else {
      y = inferYear(mo - 1, d, ref);
    }
    return makeLocalDate(y, mo - 1, d);
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

// ── Order date ──────────────────────────────────────────────────────────────
// The ORDER DATE column is free text and agents write it the way they think:
// "5/10/2026" (5 Oct, day-first), "10/5/2026" (same sale, month-first),
// "7 oct 2026", "2026-10-07", "oct 7". The sale's month (saleMonth, 'YYYY-MM')
// is the tie-breaker for ambiguous numerics: the reading whose month matches
// the sheet's month wins, then the one nearest to it, then US month-first.
// Returns 'YYYY-MM-DD' (a calendar date — no clock, no timezone) or null for
// genuine non-dates ("na", "TBD", ""). Pure and unit-tested.
const pad2 = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, mo: number, d: number) => `${y}-${pad2(mo + 1)}-${pad2(d)}`;
function validYmd(y: number, mo: number, d: number): boolean {
  if (mo < 0 || mo > 11 || d < 1 || d > 31 || y < 2000 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, mo, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo && dt.getUTCDate() === d;
}
// Months between a candidate (y, mo) and the sheet month — 0 = same month.
function monthDistance(y: number, mo: number, sheetY: number, sheetMo: number): number {
  return Math.abs((y - sheetY) * 12 + (mo - sheetMo));
}
// Year for a year-less order date: the sheet's year, nudged across a year
// boundary when that brings the month next to the sheet month (a "Dec 30"
// order in a January sheet is last year's December).
function yearNearSheet(mo: number, sheetY: number, sheetMo: number): number {
  const options = [sheetY - 1, sheetY, sheetY + 1];
  return options.reduce((best, y) => (monthDistance(y, mo, sheetY, sheetMo) < monthDistance(best, mo, sheetY, sheetMo) ? y : best), sheetY);
}

export function parseOrderDate(raw: string | null | undefined, saleMonth: string): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  const sheet = saleMonth.match(/^(\d{4})-(\d{2})$/);
  const sheetY = sheet ? Number(sheet[1]) : new Date().getFullYear();
  const sheetMo = sheet ? Number(sheet[2]) - 1 : new Date().getMonth();

  // Year-first ISO / numeric: YYYY-MM-DD, YYYY/M/D, YYYY.M.D
  const iso = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) {
    const y = Number(iso[1]), mo = Number(iso[2]) - 1, d = Number(iso[3]);
    return validYmd(y, mo, d) ? ymd(y, mo, d) : null;
  }

  // Month name + day, either order, year optional, ordinals tolerated.
  const MON = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
  const monthRe = new RegExp(
    `\\b${MON}\\.?\\s*(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(\\d{2,4}))?\\b|\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*${MON}\\.?(?:\\s*,?\\s*(\\d{2,4}))?\\b`,
    "gi"
  );
  for (const m of s.matchAll(monthRe)) {
    const name = m[1] ?? m[5];
    const dayStr = m[2] ?? m[4];
    if (!name || dayStr === undefined) continue;
    const mo = MONTHS[name.toLowerCase().slice(0, 3)];
    if (mo === undefined) continue;
    const d = Number(dayStr);
    const yStr = m[3] ?? m[6];
    let y = yStr ? Number(yStr) : yearNearSheet(mo, sheetY, sheetMo);
    if (yStr && yStr.length === 2) y = 2000 + y;
    if (validYmd(y, mo, d)) return ymd(y, mo, d);
  }

  // Numeric a/b or a/b/y: both readings are candidates when both are valid.
  const num = s.match(/\b(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?\b/);
  if (num) {
    const a = Number(num[1]), b = Number(num[2]);
    const yGiven = num[3] ? (num[3].length === 2 ? 2000 + Number(num[3]) : Number(num[3])) : null;
    const candidates: { y: number; mo: number; d: number; usFirst: boolean }[] = [];
    for (const [mo1, d1, usFirst] of [[a - 1, b, true], [b - 1, a, false]] as [number, number, boolean][]) {
      const y = yGiven ?? yearNearSheet(mo1, sheetY, sheetMo);
      if (validYmd(y, mo1, d1)) candidates.push({ y, mo: mo1, d: d1, usFirst });
    }
    if (candidates.length === 0) return null;
    candidates.sort((p, q) => {
      const dp = monthDistance(p.y, p.mo, sheetY, sheetMo), dq = monthDistance(q.y, q.mo, sheetY, sheetMo);
      if (dp !== dq) return dp - dq;
      return (q.usFirst ? 1 : 0) - (p.usFirst ? 1 : 0); // tie → US month-first
    });
    const c = candidates[0];
    return ymd(c.y, c.mo, c.d);
  }

  return null;
}

// The UTC instant of local midnight on `dateStr` ('YYYY-MM-DD') in `timeZone`.
// Used for the createdAt fallback of the date filter so "the 5th" starts at
// the company's midnight, not the server's (UTC) — an entry typed at 01:00
// IST on the 5th is 19:30 UTC on the 4th and must still count as the 5th.
export function localMidnightUtc(dateStr: string, timeZone: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return new Date(guess); // unknown zone → UTC
  }
  // offset = (what the zone shows at `guess`) − guess; local midnight = guess − offset.
  const parts = Object.fromEntries(fmt.formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
  const shown = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return new Date(guess - (shown - guess));
}

// Secure Notepad — sensitive-data detection, redaction and placeholder expiry.
//
// PURE functions (no I/O) so the exact same policy is unit-testable and is
// enforced SERVER-SIDE on every save regardless of what any client sends —
// bypassing the frontend changes nothing. Detected values are replaced with
// dated placeholders BEFORE storage; the original values are never returned,
// stored, logged or audited by any caller of this module.
//
// Detected: SSNs (dashed always; bare 9-digit only near an SSN-ish label),
// payment cards (13–19 digits, Luhn + major-brand prefix), and dates of birth
// (common formats where the year implies a plausible person age, or any date
// near a DOB-ish label). Ordinary dates (installations, deadlines) are left
// alone unless they look like a DOB.
//
// Placeholder format (plain text, Notepad-friendly):  [SSN protected 19/08/2026]
// The embedded date is the DETECTION date; a placeholder expires on the first
// Friday AFTER that date, when the weekly cleanup deletes it (and a label-only
// line it leaves behind), keeping all normal text.

export type SensitiveKind = "SSN" | "DOB" | "Card";
export type Detection = { kind: SensitiveKind };

const PLACEHOLDER_RE = /\[(SSN|DOB|Card) protected (\d{2})\/(\d{2})\/(\d{4})\]/g;

const fmt2 = (n: number) => String(n).padStart(2, "0");
function placeholder(kind: SensitiveKind, when: Date): string {
  return `[${kind} protected ${fmt2(when.getDate())}/${fmt2(when.getMonth() + 1)}/${when.getFullYear()}]`;
}

// ── Validators ─────────────────────────────────────────────────────────────
function luhnOk(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}
function cardPrefixOk(d: string): boolean {
  if (/^4\d{12}(\d{3})?(\d{3})?$/.test(d)) return true; // Visa 13/16/19
  if (/^(5[1-5]\d{14})$/.test(d)) return true; // Mastercard
  if (/^(2(2[2-9]\d|[3-6]\d\d|7[01]\d|720)\d{12})$/.test(d)) return true; // MC 2-series
  if (/^3[47]\d{13}$/.test(d)) return true; // Amex
  if (/^(6011\d{12}|65\d{14}|64[4-9]\d{13})$/.test(d)) return true; // Discover
  if (/^3(0[0-5]|[68]\d)\d{11}$/.test(d)) return true; // Diners
  if (/^35(2[89]|[3-8]\d)\d{12}$/.test(d)) return true; // JCB
  return false;
}
function ssnOk(area: string, group: string, serial: string): boolean {
  const a = Number(area);
  if (a === 0 || a === 666 || a >= 900) return false;
  if (Number(group) === 0 || Number(serial) === 0) return false;
  return true;
}
const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
function plausibleDobYear(year: number, now: Date): boolean {
  const age = now.getFullYear() - year;
  return age >= 10 && age <= 100;
}
function hasContext(text: string, index: number, re: RegExp, back = 24): boolean {
  const start = Math.max(0, index - back);
  return re.test(text.slice(start, index));
}

type Span = { start: number; end: number; kind: SensitiveKind };

// ── Detection ──────────────────────────────────────────────────────────────
export function findSensitiveSpans(text: string, now: Date = new Date()): Span[] {
  const spans: Span[] = [];
  const taken: boolean[] = [];
  const claim = (start: number, end: number, kind: SensitiveKind): void => {
    for (let i = start; i < end; i++) if (taken[i]) return;
    for (let i = start; i < end; i++) taken[i] = true;
    spans.push({ start, end, kind });
  };
  // Existing placeholders are never re-scanned (idempotency).
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    for (let i = m.index!; i < m.index! + m[0].length; i++) taken[i] = true;
  }

  // 1) Payment cards first (longest digit runs): 13–19 digits with optional
  //    single spaces/dashes between groups. Luhn + brand prefix required.
  for (const m of text.matchAll(/(?<![\d.])(?:\d[ -]?){12,18}\d(?![\d.])/g)) {
    const raw = m[0];
    const digits = raw.replace(/[ -]/g, "");
    if (digits.length < 13 || digits.length > 19) continue;
    if (!cardPrefixOk(digits) || !luhnOk(digits)) continue;
    claim(m.index!, m.index! + raw.length, "Card");
  }

  // 2) SSNs. Dashed form always counts; bare 9 digits only near an SSN label
  //    (avoids eating phone-like/order numbers).
  for (const m of text.matchAll(/\b(\d{3})-(\d{2})-(\d{4})\b/g)) {
    if (!ssnOk(m[1], m[2], m[3])) continue;
    claim(m.index!, m.index! + m[0].length, "SSN");
  }
  for (const m of text.matchAll(/\b(\d{3})(\d{2})(\d{4})\b/g)) {
    if (!ssnOk(m[1], m[2], m[3])) continue;
    if (!hasContext(text, m.index!, /ssn|social|ss\s*#|soc\b/i)) continue;
    claim(m.index!, m.index! + m[0].length, "SSN");
  }

  // 3) Dates of birth.
  const dobContext = /dob|d\.o\.b|birth|born|b-?day/i;
  // 3a) Numeric dates MM/DD/YYYY or MM-DD-YYYY (also DD/MM): DOB if the year
  //     implies a plausible age AND (context OR the date is clearly in the
  //     past by 10+ years — a strong DOB signal on its own).
  for (const m of text.matchAll(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\b/g)) {
    const year = Number(m[3]);
    if (!plausibleDobYear(year, now)) continue;
    const mo = Number(m[1]);
    const dy = Number(m[2]);
    if (mo < 1 || mo > 31 || dy < 1 || dy > 31) continue;
    if (!(hasContext(text, m.index!, dobContext) || now.getFullYear() - year >= 10)) continue;
    claim(m.index!, m.index! + m[0].length, "DOB");
  }
  // 3b) "January 15, 1990" / "15 January 1990"
  const monthName = "(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)";
  for (const m of text.matchAll(new RegExp(`\\b${monthName}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "gi"))) {
    const year = Number(m[3]);
    if (!MONTHS[m[1].toLowerCase()] || !plausibleDobYear(year, now)) continue;
    if (!(hasContext(text, m.index!, dobContext) || now.getFullYear() - year >= 10)) continue;
    claim(m.index!, m.index! + m[0].length, "DOB");
  }
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${monthName}\\.?,?\\s+(\\d{4})\\b`, "gi"))) {
    const year = Number(m[3]);
    if (!MONTHS[m[2].toLowerCase()] || !plausibleDobYear(year, now)) continue;
    if (!(hasContext(text, m.index!, dobContext) || now.getFullYear() - year >= 10)) continue;
    claim(m.index!, m.index! + m[0].length, "DOB");
  }

  return spans.sort((a, b) => a.start - b.start);
}

// Replace every detected span with its dated placeholder. Returns the
// sanitized text and the detections (kinds only — NEVER the values).
export function redactSensitive(text: string, now: Date = new Date()): { sanitized: string; detections: Detection[] } {
  const spans = findSensitiveSpans(text, now);
  if (spans.length === 0) return { sanitized: text, detections: [] };
  let out = "";
  let cursor = 0;
  for (const s of spans) {
    out += text.slice(cursor, s.start) + placeholder(s.kind, now);
    cursor = s.end;
  }
  out += text.slice(cursor);
  return { sanitized: out, detections: spans.map((s) => ({ kind: s.kind })) };
}

// The first Friday STRICTLY AFTER the given date (detected Friday → next
// Friday; detected Thursday → the very next day).
export function nextFridayAfter(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const add = ((5 - out.getDay() + 7) % 7) || 7;
  out.setDate(out.getDate() + add);
  return out;
}

// Weekly cleanup: remove placeholders whose retention deadline has passed
// (today >= their next-Friday), keeping ALL normal text. A line that consisted
// of a short label + only expired placeholders (e.g. "SSN: [SSN protected …]")
// is removed entirely — matching the spec's example — while lines with any
// other real content are kept minus the placeholder.
export function removeExpiredPlaceholders(content: string, today: Date = new Date()): { content: string; removed: number } {
  const today0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let removed = 0;
  const lines = content.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    let hadExpired = false;
    const cleaned = line.replace(PLACEHOLDER_RE, (whole, _kind, dd, mm, yyyy) => {
      const detected = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
      if (Number.isNaN(detected.getTime())) return whole;
      if (today0.getTime() >= nextFridayAfter(detected).getTime()) {
        removed++;
        hadExpired = true;
        return "";
      }
      return whole;
    });
    if (hadExpired) {
      // Drop the line entirely if only a short label (e.g. "SSN:", "DOB -")
      // remains; otherwise keep the line without the placeholder.
      const residue = cleaned.trim();
      if (residue === "" || (/^[A-Za-z .#()]{0,24}[:\-]?$/.test(residue) && residue.length <= 25)) continue;
      kept.push(cleaned.replace(/[ \t]+$/g, ""));
    } else {
      kept.push(line);
    }
  }
  return { content: kept.join("\n"), removed };
}

// Hard cap — an oversized note is rejected, never truncated silently.
export const NOTE_MAX_CHARS = 1_000_000;

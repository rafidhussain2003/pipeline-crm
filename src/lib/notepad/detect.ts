// Secure Notepad — sensitive-data detection, redaction and placeholder expiry.
//
// PURE functions (no I/O) so the exact same policy is unit-testable and is
// enforced SERVER-SIDE on every save regardless of what any client sends —
// bypassing the frontend changes nothing. Detected values are replaced with
// dated placeholders BEFORE storage; the original values are never returned,
// stored, logged or audited by any caller of this module.
//
// Detected: SSNs (dashed always; space/dot-separated or bare-9 only near an
// SSN-ish label), payment cards (13–19 digits, Luhn + major-brand prefix,
// with space/tab/dot/dash/Unicode-space separators), dates of birth (common
// formats where the year implies a plausible person age, or a date near a
// DOB-ish label), and driver's-license / state-ID numbers (a DL/ID-shaped
// token ONLY when a license/ID context label sits right before it — DL formats
// vary by state and overlap ordinary numbers, so context is what separates a
// real license number from an order / customer / lead id), bank ROUTING
// numbers (9 digits validated by the ABA checksum + prefix — detected
// context-free like a card), and bank ACCOUNT numbers (no checksum/format, so
// only near an account label). Ordinary dates (installations, deadlines) are
// left alone unless they look like a DOB.
//
// DELIBERATE LIMITATION (documented, not hidden): pattern detection cannot
// catch a value a user deliberately encodes in non-standard ways — digits
// spelled as words ("one two three…"), split across separate lines, base64,
// homoglyph letters, or astral-plane digit code points. This layer protects
// against ACCIDENTAL inclusion of PII in the common written formats and the
// realistic obfuscations (spacing, punctuation, Unicode digits); it is not,
// and cannot be, an exfiltration-proof guarantee against a determined insider
// who has legitimate note access. The audit report states this explicitly.
//
// Placeholder format (plain text, Notepad-friendly):  [SSN protected 19/08/2026]
// The embedded date is the DETECTION date; a placeholder expires on the first
// Friday AFTER that date, when the weekly cleanup deletes it (and a label-only
// line it leaves behind), keeping all normal text.

export type SensitiveKind = "SSN" | "DOB" | "Card" | "ID" | "Routing" | "Account";
export type Detection = { kind: SensitiveKind };

const PLACEHOLDER_RE = /\[(SSN|DOB|Card|ID|Routing|Account) protected (\d{2})\/(\d{2})\/(\d{4})\]/g;

// Separators allowed WITHIN a card / SSN number: ASCII space, tab, dot,
// no-break space, the Unicode general-punctuation spaces, the ideographic
// space, and hyphen. Interpolated inside a character class — the hyphen is
// LAST so it is a literal, not a range. (Newlines are deliberately excluded —
// a number split across lines is the documented residual above.)
const SEP = " \\t.\\u00A0\\u2000-\\u200A\\u202F\\u205F\\u3000-";


// ── Unicode digit folding (length-preserving) ──────────────────────────────
// Fold common BMP Unicode decimal digits to ASCII so detection sees "4111…"
// whether the attacker typed fullwidth (４), Arabic-Indic (٤), Devanagari (४),
// etc. Every folded code point is a single UTF-16 unit mapped to a single
// ASCII digit, so the folded string has the SAME length and indices — spans
// found on it apply directly to the original. Astral-plane digits (surrogate
// pairs) are intentionally NOT folded (they'd break alignment) and are called
// out as a residual in the module header.
const DIGIT_BASES = [0xff10, 0x0660, 0x06f0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0x0e50, 0x0ed0, 0x0f20, 0xff10];
function foldDigits(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 48 && code <= 57) {
      out += text[i];
      continue;
    }
    let folded = text[i];
    for (const base of DIGIT_BASES) {
      if (code >= base && code <= base + 9) {
        folded = String.fromCharCode(48 + (code - base));
        break;
      }
    }
    out += folded;
  }
  return out;
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
// ABA routing-number validator: exactly 9 digits, a valid Federal-Reserve
// routing-symbol prefix (00–12, 21–32, 61–72, 80), and the ABA checksum. Both
// constraints together make this reliable enough to detect context-free, the
// same way a card relies on Luhn + brand prefix.
function abaRoutingOk(d: string): boolean {
  if (!/^\d{9}$/.test(d)) return false;
  const p = Number(d.slice(0, 2));
  const prefixOk = p <= 12 || (p >= 21 && p <= 32) || (p >= 61 && p <= 72) || p === 80;
  if (!prefixOk) return false;
  const n = d.split("").map(Number);
  const sum = 3 * (n[0] + n[3] + n[6]) + 7 * (n[1] + n[4] + n[7]) + (n[2] + n[5] + n[8]);
  return sum % 10 === 0;
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
// Detection runs on the DIGIT-FOLDED twin (same length as `text`), so every
// returned span is valid against the original string too.
export function findSensitiveSpans(text: string, now: Date = new Date()): Span[] {
  const norm = foldDigits(text);
  const spans: Span[] = [];
  const taken: boolean[] = [];
  const claim = (start: number, end: number, kind: SensitiveKind): void => {
    for (let i = start; i < end; i++) if (taken[i]) return;
    for (let i = start; i < end; i++) taken[i] = true;
    spans.push({ start, end, kind });
  };
  // Existing placeholders are never re-scanned (idempotency).
  for (const m of norm.matchAll(PLACEHOLDER_RE)) {
    for (let i = m.index!; i < m.index! + m[0].length; i++) taken[i] = true;
  }

  // 1) Payment cards first (longest digit runs): 13–19 digits with optional
  //    single separators between them (space/tab/dot/dash/Unicode-space). Luhn
  //    + brand prefix required, so broad separators don't create false hits.
  const cardRe = new RegExp(`(?<![\\d.])(?:[0-9][${SEP}]?){12,18}[0-9](?![\\d])`, "g");
  for (const m of norm.matchAll(cardRe)) {
    const raw = m[0];
    const digits = raw.replace(/[^0-9]/g, "");
    if (digits.length < 13 || digits.length > 19) continue;
    if (!cardPrefixOk(digits) || !luhnOk(digits)) continue;
    claim(m.index!, m.index! + raw.length, "Card");
  }

  // 2) SSNs. Dashed 3-2-4 always counts (strong signal). Space/dot-separated
  //    3-2-4, or a bare 9-digit run, count only near an SSN label (avoids
  //    eating phone-like / order numbers).
  const ssnCtx = /ssn|social|ss\s*#|soc\b/i;
  for (const m of norm.matchAll(/\b(\d{3})-(\d{2})-(\d{4})\b/g)) {
    if (!ssnOk(m[1], m[2], m[3])) continue;
    claim(m.index!, m.index! + m[0].length, "SSN");
  }
  const ssnSepRe = new RegExp(`\\b(\\d{3})[${SEP}](\\d{2})[${SEP}](\\d{4})\\b`, "g");
  for (const m of norm.matchAll(ssnSepRe)) {
    if (!ssnOk(m[1], m[2], m[3])) continue;
    if (!hasContext(norm, m.index!, ssnCtx)) continue;
    claim(m.index!, m.index! + m[0].length, "SSN");
  }
  for (const m of norm.matchAll(/\b(\d{3})(\d{2})(\d{4})\b/g)) {
    if (!ssnOk(m[1], m[2], m[3])) continue;
    if (!hasContext(norm, m.index!, ssnCtx)) continue;
    claim(m.index!, m.index! + m[0].length, "SSN");
  }

  // 3) Dates of birth.
  const dobContext = /dob|d\.o\.b|birth|born|b-?day/i;
  // 3a) Numeric dates MM/DD/YYYY, MM-DD-YYYY, MM.DD.YYYY (also DD/MM): DOB if
  //     the year implies a plausible age AND (context OR the date is clearly in
  //     the past by 10+ years — a strong DOB signal on its own).
  for (const m of norm.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g)) {
    const year = Number(m[3]);
    if (!plausibleDobYear(year, now)) continue;
    const mo = Number(m[1]);
    const dy = Number(m[2]);
    if (mo < 1 || mo > 31 || dy < 1 || dy > 31) continue;
    if (!(hasContext(norm, m.index!, dobContext) || now.getFullYear() - year >= 10)) continue;
    claim(m.index!, m.index! + m[0].length, "DOB");
  }
  // 3b) "January 15, 1990" / "15 January 1990"
  const monthName = "(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)";
  for (const m of norm.matchAll(new RegExp(`\\b${monthName}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "gi"))) {
    const year = Number(m[3]);
    if (!MONTHS[m[1].toLowerCase()] || !plausibleDobYear(year, now)) continue;
    if (!(hasContext(norm, m.index!, dobContext) || now.getFullYear() - year >= 10)) continue;
    claim(m.index!, m.index! + m[0].length, "DOB");
  }
  for (const m of norm.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${monthName}\\.?,?\\s+(\\d{4})\\b`, "gi"))) {
    const year = Number(m[3]);
    if (!MONTHS[m[2].toLowerCase()] || !plausibleDobYear(year, now)) continue;
    if (!(hasContext(norm, m.index!, dobContext) || now.getFullYear() - year >= 10)) continue;
    claim(m.index!, m.index! + m[0].length, "DOB");
  }

  // 4) Driver's license / State ID numbers. DL/ID formats differ by state and
  //    overlap ordinary numbers, so — exactly like the bare-SSN rule — a
  //    DL/ID-shaped token is redacted ONLY when a license/ID context label is
  //    within ~28 chars before it. This deliberately does NOT match a bare
  //    "id" (so "customer id 4488213" / "lead id 100294" are untouched); it
  //    matches "driver's license", "DL", "DLN", "D/L", "license #/no/number",
  //    "lic #", "state id", "government/govt id", and "ID card". The token is
  //    1–2 optional leading letters + 5–14 digits + an optional trailing letter
  //    (covers CA "D1234567", TX "12345678", FL "F123456789012", NJ, NY, …).
  const idContext = /driver'?s?\s*licen[cs]e|driver'?s?\s*lic\b|\bdln\b|\bd\/l\b|\bdl\b|licen[cs]e\s*(?:no|number|#|:)|\blic\s*#|state[-\s]*(?:issued\s*)?id|govern(?:ment)?\s*id|govt\s*id|\bid\s*card\b/i;
  for (const m of norm.matchAll(/\b([A-Za-z]{0,2}\d{5,14}[A-Za-z]?)\b/g)) {
    if (!hasContext(norm, m.index!, idContext, 28)) continue;
    claim(m.index!, m.index! + m[1].length, "ID");
  }

  // 5) Bank ROUTING numbers — a bare 9-digit run that passes the ABA checksum +
  //    prefix (see abaRoutingOk). Context-free, like a card: the checksum makes
  //    a random order/reference number matching by accident rare (an invalid
  //    prefix such as "998877665" is rejected outright).
  for (const m of norm.matchAll(/\b\d{9}\b/g)) {
    if (!abaRoutingOk(m[0])) continue;
    claim(m.index!, m.index! + m[0].length, "Routing");
  }

  // 6) Bank ACCOUNT numbers — no checksum, no fixed length, so (like bare SSN /
  //    DL) a 6–17 digit run is redacted ONLY near an account context label:
  //    "account", "acct", "a/c", "checking", "savings". This keeps ordinary
  //    order / invoice / customer numbers with no such label untouched.
  const acctContext = /\baccount\b|\bacct\b|\ba\/c\b|\bchecking\b|\bsavings\b/i;
  for (const m of norm.matchAll(/\b\d[\d\- ]{4,20}\d\b/g)) {
    const digits = m[0].replace(/[^0-9]/g, "");
    if (digits.length < 6 || digits.length > 17) continue;
    if (!hasContext(norm, m.index!, acctContext, 24)) continue;
    claim(m.index!, m.index! + m[0].length, "Account");
  }

  return spans.sort((a, b) => a.start - b.start);
}

// ── Retention model ─────────────────────────────────────────────────────────
// Per the owner's rule, detected sensitive VALUES are kept READABLE so the
// agent can work the order, then auto-erased 12 hours after they were first
// typed. DOB is special: on expiry only the birth YEAR is kept. Non-sensitive
// text is always preserved. A value's "first seen" time is tracked per value —
// keyed by an HMAC of its normalized digits, NEVER the value itself — so the
// clock survives edits to surrounding text and does not reset on re-save.
export const RETENTION_MS = 12 * 60 * 60 * 1000; // default window: 12 hours
export const FOLLOWUP_MS = 7 * 24 * 60 * 60 * 1000; // "Follow Up" block: 7 days

// key = hmac(normalized value); value = kind + first-seen epoch ms.
export type SensitiveMeta = Record<string, { kind: SensitiveKind; t: number }>;

// Per-customer-block retention control. The note is split into blocks by blank
// lines. A standalone marker LINE governs how long a block's sensitive values
// live:
//   "Active" / "Activated"   → 0  (erase immediately — the order is done)
//   "Follow Up" / "Followup" → 7 days (kept longer while the order is pending)
//   otherwise                → 12 hours (default)
// The marker must be its OWN line (optionally with trailing punctuation) so an
// ordinary sentence like "wants active service" never triggers it. Active wins
// over Follow Up.
//
// CRUCIALLY, agents write the marker UNDERNEATH the customer, usually with a
// blank line (or two, plus a "****" divider) between the details and the marker
// — which drops the marker into its OWN block, so on its own it would leave the
// customer on the 12h default and erase the data the agent meant to keep. So a
// block that is ONLY a marker also governs the customer block directly ABOVE it.
// That is the whole promise of the feature: "Follow Up written below a customer
// keeps that customer".
const lineIsActive = (l: string) => /^\s*activ(?:e|ated)\s*[!.:*-]*\s*$/i.test(l);
const lineIsFollowUp = (l: string) => /^\s*follow[\s-]?up\s*[!.:*-]*\s*$/i.test(l);

type Block = { start: number; end: number; win: number };
function blockWindows(content: string): Block[] {
  type Raw = { start: number; end: number; active: boolean; follow: boolean; markerOnly: boolean };
  const raw: Raw[] = [];
  const lines = content.split("\n");
  let offset = 0;
  let start = -1;
  let active = false;
  let follow = false;
  let hasOther = false; // saw a real (non-marker) content line in this block
  const flush = (end: number) => {
    if (start >= 0) raw.push({ start, end, active, follow, markerOnly: (active || follow) && !hasOther });
    start = -1;
    active = false;
    follow = false;
    hasOther = false;
  };
  for (const line of lines) {
    const lineStart = offset;
    if (line.trim() === "") {
      flush(lineStart);
    } else {
      if (start < 0) start = lineStart;
      const act = lineIsActive(line);
      const fol = lineIsFollowUp(line);
      if (act) active = true;
      if (fol) follow = true;
      if (!act && !fol) hasOther = true;
    }
    offset = lineStart + line.length + 1; // +1 for the "\n"
  }
  flush(offset);

  // A marker-only block ("Follow Up" / "Active" alone, blank lines around it)
  // governs the customer block directly above it — that's how agents write it.
  for (let i = 1; i < raw.length; i++) {
    if (!raw[i].markerOnly) continue;
    if (raw[i].active) raw[i - 1].active = true;
    if (raw[i].follow) raw[i - 1].follow = true;
  }

  return raw.map((b) => ({ start: b.start, end: b.end, win: b.active ? 0 : b.follow ? FOLLOWUP_MS : RETENTION_MS }));
}
function windowForOffset(blocks: Block[], pos: number): number {
  for (const b of blocks) if (pos >= b.start && pos < b.end) return b.win;
  return RETENTION_MS;
}

// Identity of a value for clock-tracking: fold Unicode digits, keep only
// alphanumerics, lowercase — so "4111 1111 1111 1111", "4111-1111 1111-1111"
// and the fullwidth form share one clock.
function normValue(v: string): string {
  return foldDigits(v).replace(/[^0-9a-z]/gi, "").toLowerCase();
}

// The birth year kept when a DOB expires ("01/15/1990" -> "1990"). Empty if no
// plausible year is present (then the DOB is erased entirely).
function birthYearOf(dob: string): string {
  const m = foldDigits(dob).match(/(?:19|20)[0-9][0-9]/);
  return m ? m[0] : "";
}

// The ONE retention pass — used identically on save, load and the sweep.
// Detects sensitive values in `content`, carries each value's first-seen time
// from `prevMeta` (or stamps `nowMs` for a newly seen value), erases those
// older than 12h (DOB -> birth year), and returns the rewritten readable
// content plus the meta for the values that remain. Pure: `hmac` is injected,
// so callers supply a keyed HMAC (route/cron) or a test double.
export function applyRetention(
  content: string,
  prevMeta: SensitiveMeta,
  nowMs: number,
  hmac: (v: string) => string,
): { content: string; meta: SensitiveMeta; detected: Detection[]; expired: number } {
  const spans = findSensitiveSpans(content, new Date(nowMs));
  const blocks = blockWindows(content);
  const meta: SensitiveMeta = {};
  const detected: Detection[] = [];
  let expired = 0;
  let out = "";
  let cursor = 0;
  for (const sp of spans) {
    const value = content.slice(sp.start, sp.end);
    const key = hmac(normValue(value));
    const firstSeen = prevMeta[key]?.t ?? nowMs;
    const win = windowForOffset(blocks, sp.start); // 12h / 7d / 0, per this value's block
    out += content.slice(cursor, sp.start);
    if (nowMs - firstSeen >= win) {
      expired++;
      if (sp.kind === "DOB") out += birthYearOf(value); // keep birth year only
      // every other kind: erase the value entirely (append nothing)
    } else {
      out += value; // still within the window -> keep it readable
      meta[key] = { kind: sp.kind, t: firstSeen };
      detected.push({ kind: sp.kind });
    }
    cursor = sp.end;
  }
  out += content.slice(cursor);
  return { content: out, meta, detected, expired };
}

// Hard cap — an oversized note is rejected, never truncated silently.
export const NOTE_MAX_CHARS = 1_000_000;

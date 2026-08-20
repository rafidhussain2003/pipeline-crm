/* Secure Notepad — detection / redaction / cleanup regression suite.
 *
 * Run: npm run test:notepad   (executes with tsx; no test framework needed)
 *
 * This suite is ADVERSARIAL by design — it is the post-deployment security
 * audit's evidence. It covers: obfuscation bypasses (spacing, punctuation,
 * Unicode digits, tabs, multiple/long inputs), false-positive protection of
 * legitimate business data, overlapping/multiple detections, idempotency,
 * Friday-expiry math, and cleanup safety (never empties a note, drops only
 * label lines, keeps mixed lines). A fixed `NOW` keeps every case deterministic.
 */
import { redactSensitive, removeExpiredPlaceholders, nextFridayAfter, findSensitiveSpans, NOTE_MAX_CHARS } from "./detect";

const NOW = new Date(2026, 7, 19); // Wed 19 Aug 2026 (local)
let pass = 0;
const fails: string[] = [];
function check(name: string, cond: boolean, extra?: string) {
  if (cond) pass++;
  else fails.push(name + (extra ? `  [${extra}]` : ""));
}
const redacted = (t: string) => redactSensitive(t, NOW).sanitized;
const nDetect = (t: string) => redactSensitive(t, NOW).detections.length;

// ── 1. The spec's canonical example ─────────────────────────────────────────
{
  const ex = "Customer John\nPhone: 555-123-4567\nSSN: 123-45-6789\nDOB: 01/15/1990\nNeeds callback tomorrow";
  const r = redactSensitive(ex, NOW);
  check("spec: SSN redacted", !r.sanitized.includes("123-45-6789"));
  check("spec: DOB redacted", !r.sanitized.includes("01/15/1990"));
  check("spec: phone kept", r.sanitized.includes("555-123-4567"));
  check("spec: names/notes kept", r.sanitized.includes("Customer John") && r.sanitized.includes("Needs callback tomorrow"));
  check("spec: exactly 2 detections", r.detections.length === 2);
  check("spec: placeholders dated", /\[SSN protected 19\/08\/2026\]/.test(r.sanitized) && /\[DOB protected 19\/08\/2026\]/.test(r.sanitized));
}

// ── 2. Bypass attempts — the original value must NOT survive ─────────────────
const bypass: [string, string, string][] = [
  // name, input, literal-that-must-not-survive
  ["card spaced", "card 4111 1111 1111 1111 end", "4111 1111 1111 1111"],
  ["card solid", "card 4111111111111111 end", "4111111111111111"],
  ["card dot-separated", "card 4111.1111.1111.1111 end", "4111.1111.1111.1111"],
  ["card tab-separated", "card 4111\t1111\t1111\t1111 end", "4111\t1111\t1111\t1111"],
  ["card nbsp-separated", "card 4111 1111 1111 1111 end", "4111 1111 1111 1111"],
  ["card mixed space+dash", "c 4111-1111 1111-1111 x", "4111-1111 1111-1111"],
  ["card fullwidth digits", "c ４１１１１１１１１１１１１１１１ x", "４１１１"],
  ["card amex", "amex 378282246310005 x", "378282246310005"],
  ["card mastercard", "mc 5500005555555559 x", "5500005555555559"],
  ["ssn dashed", "SSN 123-45-6789", "123-45-6789"],
  ["ssn bare+ctx", "SSN: 123456789", "123456789"],
  ["ssn spaced+ctx", "SSN 123 45 6789", "123 45 6789"],
  ["ssn dotted+ctx", "social 123.45.6789", "123.45.6789"],
  ["ssn fullwidth+ctx", "SSN １２３-４５-６７８９", "１２３"],
  ["ssn mixed-case label", "sSn: 123-45-6789", "123-45-6789"],
  ["dob slash+ctx", "DOB 01/15/1990", "01/15/1990"],
  ["dob dotted+ctx", "DOB 01.15.1990", "01.15.1990"],
  ["dob written", "born January 15, 1990", "January 15, 1990"],
  ["dob written reversed", "dob 15 January 1990", "15 January 1990"],
  ["dob unlabeled old date", "note 01/15/1988 here", "01/15/1988"],
  ["multi: second card", "4111 1111 1111 1111 and 5500005555555559", "5500005555555559"],
  ["long: card in 100k text", "x".repeat(50000) + " 4111111111111111 " + "y".repeat(50000), "4111111111111111"],
  ["repeated: same ssn twice", "SSN 123-45-6789 again 123-45-6789", "123-45-6789"],
  // Driver's license / State ID — redacted only with a license/ID context label.
  ["dl: DL# California", "DL# D1234567", "D1234567"],
  ["dl: driver's license Florida", "driver's license F123456789012", "F123456789012"],
  ["dl: state id", "state id 12345678", "12345678"],
  ["dl: License No", "License No: A1234567", "A1234567"],
  ["dl: DLN", "customer DLN 987654321 on file", "987654321"],
  ["dl: D/L", "D/L 123456789", "123456789"],
  ["dl: government id", "government id 12345678", "12345678"],
  ["dl: ID card", "ID card 87654321", "87654321"],
  ["dl: lowercase label", "dl# d1234567", "d1234567"],
];
for (const [name, input, secret] of bypass) {
  check(`bypass: ${name}`, !redacted(input).includes(secret), JSON.stringify(redacted(input).slice(0, 60)));
}

// ── 3. False positives — legitimate data must survive untouched ──────────────
const keep = [
  "phone 555-123-4567", "call 5551234567", "install 08/25/2026", "order date 08/04/2026",
  "appointment 13/08/2026", "ZIP 90210", "invoice #INV-2026-0042", "customer id 4488213",
  "lead id 100294", "price $4,111.00", "acct 12345678", "tracking 1234567890",
  "order 1234 5678 9012 3456", "contract 03/01/2024", "meeting Jan 15, 2026",
  "192.168.1.1", "version 4.1.1.1", "call at 3:45 pm", "suite 400-A",
  // DL/ID false-positive guards — no license/ID context → must survive.
  "order confirmation 12345678", "call log 5551234567", "reference 998877665",
  "driver's license expires 2025", "renewed license in 2027",
];
for (const t of keep) check(`keep: ${t}`, nDetect(t) === 0, JSON.stringify(redacted(t)));

// ── 4. Overlapping / multiple / idempotency ─────────────────────────────────
{
  const multi = "SSN 123-45-6789 card 4111111111111111 dob 01/15/1990";
  check("multi: 3 kinds detected", nDetect(multi) === 3);
  const once = redacted(multi);
  const twice = redacted(once);
  check("idempotent: re-redaction is a no-op", twice === once && nDetect(once) === 0);
  // A user typing a fake placeholder is not re-scanned.
  check("idempotent: existing placeholder untouched", redacted("x [Card protected 01/01/2020] y") === "x [Card protected 01/01/2020] y");
  // Spans never overlap.
  const spans = findSensitiveSpans(multi, NOW);
  let overlap = false;
  for (let i = 1; i < spans.length; i++) if (spans[i].start < spans[i - 1].end) overlap = true;
  check("spans: never overlap", !overlap);
}

// ── 5. Friday-expiry math (timezone policy: server-LOCAL calendar day) ───────
check("friday: Wed→Fri (2 days)", nextFridayAfter(new Date(2026, 7, 19)).getDate() === 21);
check("friday: Fri→next Fri (strictly after)", nextFridayAfter(new Date(2026, 7, 21)).getDate() === 28);
check("friday: Thu→Fri (next day)", nextFridayAfter(new Date(2026, 7, 20)).getDate() === 21);
check("friday: Sat→Fri (6 days)", nextFridayAfter(new Date(2026, 7, 22)).getDate() === 28);

// ── 6. Cleanup safety ───────────────────────────────────────────────────────
{
  const note = "Customer John\nPhone: 555-123-4567\nSSN: [SSN protected 12/08/2026]\nDOB: [DOB protected 12/08/2026]\nNeeds callback";
  const beforeFri = removeExpiredPlaceholders(note, new Date(2026, 7, 13)); // Thu before → not yet
  check("cleanup: nothing removed before the Friday deadline", beforeFri.removed === 0 && beforeFri.content === note);
  const onFri = removeExpiredPlaceholders(note, new Date(2026, 7, 14)); // Fri 14th ≥ nextFriday(12th)=14th
  check("cleanup: expired placeholders removed on/after deadline", onFri.removed === 2);
  check("cleanup: label-only lines dropped", !onFri.content.includes("SSN") && !onFri.content.includes("DOB"));
  check("cleanup: normal lines fully intact", onFri.content.includes("Customer John") && onFri.content.includes("Phone: 555-123-4567") && onFri.content.includes("Needs callback"));
  check("cleanup: never empties a note with normal content", onFri.content.trim().length > 0);
  // A line with OTHER real content keeps the text, drops only the placeholder.
  const mixed = removeExpiredPlaceholders("ref [SSN protected 12/08/2026] keep this", new Date(2026, 7, 14));
  check("cleanup: mixed line keeps real text", mixed.content.includes("keep this") && !mixed.content.includes("[SSN"));
  // Idempotent + a not-yet-expired placeholder is preserved.
  check("cleanup: idempotent", removeExpiredPlaceholders(onFri.content, new Date(2026, 7, 21)).content === onFri.content);
  const future = "x [Card protected 19/08/2026] y"; // nextFriday = 21 Aug
  check("cleanup: unexpired placeholder preserved", removeExpiredPlaceholders(future, new Date(2026, 7, 20)).removed === 0);
  // Cleanup of a note with NO placeholders is a pure no-op.
  check("cleanup: no-placeholder note untouched", removeExpiredPlaceholders("just normal text\nline two", NOW).content === "just normal text\nline two");
}

// ── 7. XSS / HTML injection round-trips as literal text (no detection, no mangling) ─
for (const payload of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', 'javascript:alert(1)', '"><svg/onload=alert(1)>']) {
  check(`xss literal: ${payload.slice(0, 16)}`, redacted(payload) === payload && nDetect(payload) === 0);
}

// ── 8. Guards ────────────────────────────────────────────────────────────────
check("size cap constant is 1,000,000", NOTE_MAX_CHARS === 1_000_000);
check("empty input → no detections", nDetect("") === 0 && redacted("") === "");

// ── Report ───────────────────────────────────────────────────────────────────
console.log(`\nSecure Notepad detection suite: ${pass} passed, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log("  FAIL: " + f);
  process.exit(1);
}
console.log("ALL PASS");

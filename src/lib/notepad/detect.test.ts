/* Secure Notepad — detection + 12-hour retention regression suite.
 *
 * Run: npm run test:notepad   (executes with tsx; no test framework needed)
 *
 * Retention model (owner rule): a detected sensitive value is kept READABLE for
 * 12h after first typed, then auto-erased — DOB keeps only its birth year.
 * This suite is adversarial: obfuscation bypasses must all be DETECTED (so the
 * clock applies), legitimate business data must never be detected, and the
 * expiry/carry-over/birth-year behaviour is verified with a fixed clock.
 */
import { applyRetention, findSensitiveSpans, RETENTION_MS, NOTE_MAX_CHARS, type SensitiveMeta } from "./detect";

const NOW = new Date(2026, 7, 19, 12, 0, 0).getTime(); // fixed clock (ms)
const H = (v: string) => "h:" + v; // deterministic test HMAC
const fresh = (t: string) => applyRetention(t, {}, NOW, H); // fresh save: within window
const age = (m: SensitiveMeta, ms: number): SensitiveMeta =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { ...v, t: NOW - ms }]));

let pass = 0;
const fails: string[] = [];
const check = (name: string, cond: boolean, extra?: string) => { if (cond) pass++; else fails.push(name + (extra ? `  [${extra}]` : "")); };

// ── 1. Spec example: sensitive kept readable now; erased after 12h ───────────
{
  const ex = "Customer John\nPhone: 555-123-4567\nSSN: 123-45-6789\nDOB: 01/15/1990\nNeeds callback";
  const now0 = fresh(ex);
  check("fresh: SSN kept readable in window", now0.content.includes("123-45-6789"));
  check("fresh: DOB kept readable in window", now0.content.includes("01/15/1990"));
  check("fresh: 2 sensitive detected (SSN+DOB)", now0.detected.length === 2);
  check("fresh: name + phone + note untouched", now0.content.includes("Customer John") && now0.content.includes("555-123-4567") && now0.content.includes("Needs callback"));
  const later = applyRetention(ex, age(now0.meta, RETENTION_MS + 1000), NOW, H);
  check("expired: SSN erased after 12h", !later.content.includes("123-45-6789"));
  check("expired: DOB reduced to birth year", later.content.includes("1990") && !later.content.includes("01/15/1990"));
  check("expired: name + phone + note still intact", later.content.includes("Customer John") && later.content.includes("555-123-4567") && later.content.includes("Needs callback"));
  check("expired: count = 2", later.expired === 2);
}

// ── 2. Bypass attempts must all be DETECTED (so the 12h clock applies) ───────
const bypass: [string, string][] = [
  ["card spaced", "card 4111 1111 1111 1111 end"],
  ["card solid", "card 4111111111111111 end"],
  ["card dot-separated", "card 4111.1111.1111.1111 end"],
  ["card tab-separated", "card 4111\t1111\t1111\t1111 end"],
  ["card nbsp-separated", "card 4111 1111 1111 1111 end"],
  ["card mixed space+dash", "c 4111-1111 1111-1111 x"],
  ["card fullwidth digits", "c ４１１１１１１１１１１１１１１１ x"],
  ["card amex", "amex 378282246310005 x"],
  ["ssn dashed", "SSN 123-45-6789"],
  ["ssn bare+ctx", "SSN: 123456789"],
  ["ssn spaced+ctx", "SSN 123 45 6789"],
  ["ssn dotted+ctx", "social 123.45.6789"],
  ["dob slash+ctx", "DOB 01/15/1990"],
  ["dob dotted+ctx", "DOB 01.15.1990"],
  ["dob written", "born January 15, 1990"],
  ["dl DL#", "DL# D1234567"],
  ["dl driver's license", "driver's license F123456789012"],
  ["dl state id", "state id 12345678"],
  ["routing bare valid", "wire to 121000248 today"],
  ["routing labeled", "ABA 111000025"],
  ["account label", "account 9988776655"],
  ["account acct", "acct 12345678"],
];
for (const [name, input] of bypass) {
  const r = fresh(input);
  check(`detect: ${name}`, r.detected.length >= 1, JSON.stringify(r.detected));
}

// ── 3. False positives — legitimate data never detected/tracked ─────────────
const keep = [
  "phone 555-123-4567", "call 5551234567", "install 08/25/2026", "order date 08/04/2026",
  "appointment 13/08/2026", "ZIP 90210", "invoice #INV-2026-0042", "customer id 4488213",
  "lead id 100294", "price $4,111.00", "tracking 1234567890",
  "order 1234 5678 9012 3456", "contract 03/01/2024", "meeting Jan 15, 2026",
  "192.168.1.1", "version 4.1.1.1", "call at 3:45 pm", "suite 400-A",
  "order confirmation 12345678", "call log 5551234567",
  "driver's license expires 2025", "renewed license in 2027",
  "reference 998877665", "invoice 123456789", "order 987654321", "discount code 12345678",
];
for (const t of keep) check(`keep: ${t}`, fresh(t).detected.length === 0, JSON.stringify(fresh(t).detected));

// ── 4. Clock carry-over — a value's 12h timer does NOT reset on re-save ──────
{
  const first = fresh("card 4111111111111111 end");
  const oneHourAgo = age(first.meta, 60 * 60 * 1000);
  const again = applyRetention("card 4111111111111111 end", oneHourAgo, NOW, H);
  check("carry-over: still readable at 1h", again.content.includes("4111111111111111"));
  check("carry-over: clock NOT reset to now", Object.values(again.meta)[0].t === NOW - 60 * 60 * 1000);
  const at11h = applyRetention("card 4111111111111111 end", age(first.meta, 11 * 60 * 60 * 1000), NOW, H);
  check("carry-over: still readable at 11h", at11h.content.includes("4111111111111111"));
  const at13h = applyRetention("card 4111111111111111 end", age(first.meta, 13 * 60 * 60 * 1000), NOW, H);
  check("carry-over: erased at 13h", !at13h.content.includes("4111111111111111") && at13h.expired === 1);
}

// ── 5. Birth-year extraction on DOB expiry ──────────────────────────────────
for (const [dob, year] of [["DOB 01/15/1990", "1990"], ["born January 15, 1990", "1990"], ["dob 15 January 1988", "1988"], ["DOB 01.15.1975", "1975"]] as [string, string][]) {
  const f = fresh(dob);
  const exp = applyRetention(dob, age(f.meta, RETENTION_MS + 1), NOW, H);
  check(`birthyear: ${dob} -> ${year}`, exp.content.includes(year) && !/\b\d{1,2}[/.\s]\d{1,2}\b/.test(exp.content.replace(year, "")), JSON.stringify(exp.content));
}

// ── 6. Erasing a non-DOB value leaves surrounding text ──────────────────────
{
  const f = fresh("Acct 12345678 — call after 5");
  const exp = applyRetention("Acct 12345678 — call after 5", age(f.meta, RETENTION_MS + 1), NOW, H);
  check("erase: account value gone", !exp.content.includes("12345678"));
  check("erase: surrounding text kept", exp.content.includes("Acct") && exp.content.includes("call after 5"));
}

// ── 7. Idempotency + multi + no-op ──────────────────────────────────────────
{
  const multi = "SSN 123-45-6789 card 4111111111111111 dob 01/15/1990";
  check("multi: 3 detected", fresh(multi).detected.length === 3);
  const expiredMeta = age(fresh(multi).meta, RETENTION_MS + 1);
  const gone = applyRetention(multi, expiredMeta, NOW, H);
  const goneAgain = applyRetention(gone.content, gone.meta, NOW, H);
  check("idempotent: re-running after expiry is a no-op", goneAgain.content === gone.content && goneAgain.detected.length === 0);
  check("no-op: plain text untouched, nothing detected", fresh("just normal text\nline two").content === "just normal text\nline two" && fresh("just normal text\nline two").detected.length === 0);
  // findSensitiveSpans never overlaps.
  const spans = findSensitiveSpans(multi, new Date(NOW));
  let overlap = false;
  for (let i = 1; i < spans.length; i++) if (spans[i].start < spans[i - 1].end) overlap = true;
  check("spans: never overlap", !overlap);
}

// ── 8. XSS / HTML injection round-trips as literal text (never detected) ─────
for (const payload of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', 'javascript:alert(1)']) {
  check(`xss literal: ${payload.slice(0, 12)}`, fresh(payload).content === payload && fresh(payload).detected.length === 0);
}

// ── 10. Block markers — Follow Up (7 days) & Active (immediate) ──────────────
{
  const card = "4111111111111111";
  // Follow Up → 7-day window: still readable past 12h, gone after 8 days.
  const fu = "John card " + card + "\nFollow Up";
  const fuFresh = applyRetention(fu, {}, NOW, H);
  check("followup: detected + kept fresh", fuFresh.detected.length === 1 && fuFresh.content.includes(card));
  check("followup: still readable at 13h (7d window)", applyRetention(fu, age(fuFresh.meta, 13 * 60 * 60 * 1000), NOW, H).content.includes(card));
  check("followup: erased after 8 days", !applyRetention(fu, age(fuFresh.meta, 8 * 24 * 60 * 60 * 1000), NOW, H).content.includes(card));

  // Active → erased immediately, even on the very first pass.
  const act = "John card " + card + "\nActive";
  const actFresh = applyRetention(act, {}, NOW, H);
  check("active: erased immediately", !actFresh.content.includes(card) && actFresh.expired === 1);
  check("active: non-sensitive kept", actFresh.content.includes("John") && actFresh.content.includes("Active"));

  // Standalone-only: "active" inside a sentence must NOT trigger immediate erase.
  const sentence = "John card " + card + "\ncustomer wants active service";
  check("active: embedded word does NOT trigger", applyRetention(sentence, {}, NOW, H).content.includes(card));

  // Block isolation: Active in block A erases only A; Follow Up block B kept.
  const two = "A card " + card + "\nActive\n\nB card 5500005555555559\nFollow Up";
  const twoRes = applyRetention(two, {}, NOW, H);
  check("blocks: Active block A erased", !twoRes.content.includes(card));
  check("blocks: Follow Up block B kept", twoRes.content.includes("5500005555555559"));

  // ── Real agent layout: the marker sits a BLANK LINE under the customer ──
  // (regression) A blank line between the details and "Follow Up" dropped the
  // marker into its own block, so the customer fell back to 12h and got erased.
  const gap = "Tyrone card " + card + "\n\nFollow Up";
  const gapFresh = applyRetention(gap, {}, NOW, H);
  check("followup(gap): kept at 13h", applyRetention(gap, age(gapFresh.meta, 13 * 60 * 60 * 1000), NOW, H).content.includes(card));
  check("followup(gap): erased after 8 days", !applyRetention(gap, age(gapFresh.meta, 8 * 24 * 60 * 60 * 1000), NOW, H).content.includes(card));

  // The exact sheet shape: "****" dividers + multiple blank lines around it.
  const sheet = "************\nMoody card " + card + "\nDL info\n\nFollow Up\n\n\n************\nNext one";
  const sheetFresh = applyRetention(sheet, {}, NOW, H);
  check("followup(sheet): kept at 13h across **** layout", applyRetention(sheet, age(sheetFresh.meta, 13 * 60 * 60 * 1000), NOW, H).content.includes(card));

  // "Active" a blank line under the customer still erases it (propagates up).
  check("active(gap): erased immediately", !applyRetention("Sold card " + card + "\n\nActive", {}, NOW, H).content.includes(card));

  // Direction: a standalone marker governs the customer ABOVE it, not below.
  const dir = "A card " + card + "\n\nFollow Up\n\nB card 5500005555555559";
  const dir13h = applyRetention(dir, age(applyRetention(dir, {}, NOW, H).meta, 13 * 60 * 60 * 1000), NOW, H);
  check("direction: A above marker kept at 13h", dir13h.content.includes(card));
  check("direction: B below marker on default 12h (erased)", !dir13h.content.includes("5500005555555559"));
}

// ── 9. Guards ────────────────────────────────────────────────────────────────
check("retention window is 12h", RETENTION_MS === 12 * 60 * 60 * 1000);
check("size cap is 1,000,000", NOTE_MAX_CHARS === 1_000_000);
check("empty input → nothing", fresh("").content === "" && fresh("").detected.length === 0);

// ── Report ───────────────────────────────────────────────────────────────────
console.log(`\nSecure Notepad retention suite: ${pass} passed, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log("  FAIL: " + f);
  process.exit(1);
}
console.log("ALL PASS");

// Enterprise disposition taxonomy — the single source of truth for the
// default disposition set and for what each label MEANS to the rest of the
// system (won / lost / terminal).
//
// Dispositions are stored on leads as LABEL strings and are per-company
// configurable (disposition_options), so the semantic groupings here are
// membership lists over labels, not enums. Every module that previously
// compared against the single WON_DISPOSITION ("Sold") or the two-element
// TERMINAL_DISPOSITIONS now derives from these lists — one place to extend
// when a company's vocabulary grows, instead of eight scattered equality
// checks that silently miss new labels.
//
// Legacy labels ("Sold", "Answering Machine", "Qualified") are kept as
// first-class members: live companies have leads carrying them, and history
// must keep counting correctly forever.

// Display/grouping order for the leads-page select and any category UI.
export const DISPOSITION_CATEGORIES = [
  "NEW",
  "CONTACT ATTEMPT",
  "INTERESTED",
  "SALES",
  "LOST",
  "OTHER",
] as const;

export type DispositionCategory = (typeof DISPOSITION_CATEGORIES)[number];

export type DefaultDisposition = {
  label: string;
  category: DispositionCategory;
  color: string;
  sortOrder: number;
};

// Seeded for every new company (signup/register) and backfilled to existing
// companies by migration 0037. sortOrder is globally ordered across
// categories with per-category gaps so legacy labels slot in without
// renumbering.
export const DEFAULT_DISPOSITIONS: DefaultDisposition[] = [
  // NEW (0-9)
  { label: "New Lead", category: "NEW", color: "#2563eb", sortOrder: 0 },
  // CONTACT ATTEMPT (10-19)
  { label: "No Answer", category: "CONTACT ATTEMPT", color: "#d97706", sortOrder: 10 },
  { label: "Busy", category: "CONTACT ATTEMPT", color: "#d97706", sortOrder: 11 },
  { label: "Hung Up", category: "CONTACT ATTEMPT", color: "#d97706", sortOrder: 12 },
  { label: "Voicemail Left", category: "CONTACT ATTEMPT", color: "#d97706", sortOrder: 13 },
  { label: "Wrong Number", category: "CONTACT ATTEMPT", color: "#d97706", sortOrder: 14 },
  // 15 is the legacy "Answering Machine" slot (see migration 0037).
  { label: "Disconnected", category: "CONTACT ATTEMPT", color: "#d97706", sortOrder: 16 },
  // INTERESTED (20-29)
  { label: "Interested", category: "INTERESTED", color: "#0891b2", sortOrder: 20 },
  { label: "Follow-up Scheduled", category: "INTERESTED", color: "#0891b2", sortOrder: 21 },
  { label: "Call Back Later", category: "INTERESTED", color: "#0891b2", sortOrder: 22 },
  // 23 is the legacy "Qualified" slot (see migration 0037).
  { label: "Call Back", category: "INTERESTED", color: "#0891b2", sortOrder: 24 },
  { label: "In Progress", category: "INTERESTED", color: "#0891b2", sortOrder: 25 },
  // SALES (30-39)
  { label: "Sale Closed", category: "SALES", color: "#16a34a", sortOrder: 30 },
  { label: "Installation Scheduled", category: "SALES", color: "#16a34a", sortOrder: 31 },
  // LOST (40-49)
  { label: "High Price", category: "LOST", color: "#dc2626", sortOrder: 40 },
  { label: "Not Interested", category: "LOST", color: "#dc2626", sortOrder: 41 },
  { label: "Already Has Service", category: "LOST", color: "#dc2626", sortOrder: 42 },
  { label: "Competitor Chosen", category: "LOST", color: "#dc2626", sortOrder: 43 },
  { label: "Credit Declined", category: "LOST", color: "#dc2626", sortOrder: 44 },
  { label: "Duplicate Lead", category: "LOST", color: "#dc2626", sortOrder: 45 },
  { label: "Out of Service Area", category: "LOST", color: "#dc2626", sortOrder: 46 },
  // OTHER (50+)
  { label: "Do Not Call", category: "OTHER", color: "#64748b", sortOrder: 50 },
  { label: "Invalid Lead", category: "OTHER", color: "#64748b", sortOrder: 51 },
];

// A lead in any of these dispositions counts as WON (conversion metrics,
// lifecycle "won", insight tags). A lead sits in exactly one disposition at
// a time, so listing both "Sale Closed" and its follow-on "Installation
// Scheduled" can never double-count a win — it keeps the lead counting as
// won after it advances. "Sold" is the pre-taxonomy label live data carries.
export const WON_DISPOSITIONS = ["Sale Closed", "Installation Scheduled", "Sold"];

// Negative-terminal labels: the lead is done and it was not a sale. "Do Not
// Call" / "Invalid Lead" live under the OTHER display category but carry
// lost semantics — they must never be recycled, rebalanced or counted as
// open workload. "Lost" is not seeded but some existing code treated it as
// terminal-negative (see callbacks/prioritize, insights/classify), so it
// stays recognized.
export const LOST_DISPOSITIONS = [
  "High Price",
  "Not Interested",
  "Already Has Service",
  "Competitor Chosen",
  "Credit Declined",
  "Duplicate Lead",
  "Out of Service Area",
  "Do Not Call",
  "Invalid Lead",
  "Lost",
];

// "This lead is done" — open-workload counts, the recycle/rebalance engines
// and the queue sweep all exclude these. Re-exported by
// src/lib/assignment/constants.ts to preserve existing import paths.
export const TERMINAL_DISPOSITIONS = [...WON_DISPOSITIONS, ...LOST_DISPOSITIONS];

const WON_SET = new Set(WON_DISPOSITIONS);
const LOST_SET = new Set(LOST_DISPOSITIONS);

export function isWonDisposition(disposition: string | null | undefined): boolean {
  return !!disposition && WON_SET.has(disposition);
}

export function isLostDisposition(disposition: string | null | undefined): boolean {
  return !!disposition && LOST_SET.has(disposition);
}

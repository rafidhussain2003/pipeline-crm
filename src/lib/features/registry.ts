// Phase 18 — the centralized feature catalog. THE single source of truth for
// which modules exist on the platform. Adding a future module is ONE entry
// here (plus guarding its routes and its sidebar item) — nothing else:
// resolver, owner UI, defaults, audit and caching all key off this array.
export interface FeatureDef {
  key: string;
  label: string;
  description: string;
  // Whether a company with no explicit profile has this module. Every module
  // that is live in the product today defaults ON so existing companies are
  // completely unaffected by the feature system's introduction.
  defaultEnabled: boolean;
  // Core modules can never be disabled (disabling CRM would brick the tenant
  // — every other module hangs off it). The owner UI shows them locked.
  core?: boolean;
  // Registered but not built yet ("coming soon"): can be toggled on a company
  // profile so packaging/sales can be prepared, but there is no product
  // surface behind them. Per the Phase 18 spec these have NO pages, NO
  // entities, NO database logic — registry entries only.
  placeholder?: boolean;
}

export const FEATURES: readonly FeatureDef[] = [
  { key: "crm", label: "CRM", description: "Leads, pipeline, notes, tags, team management — the core product.", defaultEnabled: true, core: true },
  { key: "meta_integration", label: "Meta Integration", description: "Facebook Lead Ads connection, lead sync and the Conversions API.", defaultEnabled: true },
  { key: "website_forms", label: "Website Forms", description: "Embedded and hosted website forms feeding leads into the CRM.", defaultEnabled: true },
  { key: "historical_imports", label: "Historical Imports", description: "Backfill of historical Meta leads into the CRM.", defaultEnabled: true },
  { key: "ai_assignment", label: "AI Assignment", description: "Automatic AI lead routing and its configuration surface.", defaultEnabled: true },
  { key: "progressive_lead_release", label: "Progressive Lead Release", description: "Paced, tier-based release of the overnight lead backlog.", defaultEnabled: true },
  { key: "operations_center", label: "Operations Center", description: "Live company operations dashboard for admins and managers.", defaultEnabled: true },
  { key: "internal_mailbox", label: "Internal Mailbox", description: "Platform-owner internal email (super-admin surface).", defaultEnabled: true },
  { key: "callback_engine", label: "Callback Engine", description: "Scheduled callbacks, reminders and the callback dashboard.", defaultEnabled: true },
  // Finance (Phase 19): a real module now — chart of accounts, general ledger,
  // journal entries, revenue/expenses, cash & bank accounts, financial years.
  // Still defaultEnabled: false — it's an optional paid module the Platform
  // Owner switches on per company.
  { key: "finance", label: "Finance", description: "Bookkeeping foundation: chart of accounts, general ledger, journals, revenue & expenses.", defaultEnabled: false },
  // ── Optional future modules — registered only (no pages, no entities). ────
  // Attendance (Phase 20): a real module now — check-in/out, breaks, shifts,
  // leave, holidays, logs. Optional paid module, owner-enabled per company.
  { key: "attendance", label: "Attendance", description: "Attendance & shifts: check-in/out, breaks, leave, holidays, logs.", defaultEnabled: false },
  { key: "payroll", label: "Payroll", description: "Payroll module (coming soon).", defaultEnabled: false, placeholder: true },
  { key: "bookkeeping", label: "Bookkeeping", description: "Bookkeeping module (coming soon).", defaultEnabled: false, placeholder: true },
  { key: "reports", label: "Reports", description: "Advanced reporting module (coming soon).", defaultEnabled: false, placeholder: true },
  { key: "future_ai", label: "Future AI", description: "Next-generation AI capabilities (coming soon).", defaultEnabled: false, placeholder: true },
  { key: "projects", label: "Projects", description: "Project management module (coming soon).", defaultEnabled: false, placeholder: true },
  { key: "assets", label: "Assets", description: "Asset management module (coming soon).", defaultEnabled: false, placeholder: true },
  { key: "inventory", label: "Inventory", description: "Inventory module (coming soon).", defaultEnabled: false, placeholder: true },
  { key: "hr", label: "HR", description: "Human resources module (coming soon).", defaultEnabled: false, placeholder: true },
] as const;

export type FeatureKey = (typeof FEATURES)[number]["key"];

const BY_KEY = new Map(FEATURES.map((f) => [f.key, f]));

export function featureDef(key: string): FeatureDef | undefined {
  return BY_KEY.get(key);
}
export function isKnownFeature(key: string): key is FeatureKey {
  return BY_KEY.has(key);
}

// The default profile — what a company with no stored overrides gets.
export function defaultFeatureMap(): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const f of FEATURES) map[f.key] = f.defaultEnabled;
  return map;
}

// Phase 11 — supported Meta events + CRM-trigger → event mapping helpers.
// A "trigger" is what happened in the CRM: a system event ("lead_created" /
// "lead_assigned") or a disposition the lead moved to (company-configurable,
// e.g. "Qualified", "Appointment Booked", "Sold"). Mappings live in the
// capi_event_mappings table and are fully editable; this file just supplies the
// selectable event list + sensible defaults so a new pixel works out of the box.

// Standard Meta events plus the CRM-lifecycle-friendly "QualifiedLead" custom
// event. Admins can also type any custom event name in the UI.
export const META_EVENTS = [
  "Lead",
  "QualifiedLead",
  "Contact",
  "Schedule",
  "Purchase",
  "CompleteRegistration",
  "SubmitApplication",
  "StartTrial",
  "Subscribe",
] as const;

export const SYSTEM_TRIGGERS: { key: string; label: string }[] = [
  { key: "lead_created", label: "Lead Created" },
  { key: "lead_assigned", label: "Lead Assigned" },
];

// Heuristic default for a trigger, used to seed a new pixel's mapping so it's
// useful immediately. Returns a Meta event name, or null for "No Event".
export function defaultMetaEventFor(trigger: string): string | null {
  const t = trigger.toLowerCase();
  if (trigger === "lead_created") return "Lead";
  if (trigger === "lead_assigned") return null; // opt-in — often noisy
  if (/(sold|won|closed won|purchase|customer|deal)/.test(t)) return "Purchase";
  if (/(qualified)/.test(t)) return "QualifiedLead";
  if (/(appointment|schedule|booked|demo|meeting)/.test(t)) return "Schedule";
  if (/(contact|reached|spoke|call)/.test(t)) return "Contact";
  if (/(lost|not interested|dead|unqualified|spam|invalid|dnc)/.test(t)) return null; // No Event
  if (/(new lead|new)/.test(t)) return "Lead";
  return null; // admin decides
}

export type MappingRow = { trigger: string; metaEvent: string | null; enabled: boolean };

// Resolve the Meta event for a fired trigger. Returns null when unmapped,
// disabled, or explicitly "No Event".
export function resolveEvent(mappings: MappingRow[], trigger: string): string | null {
  const m = mappings.find((x) => x.trigger === trigger);
  if (!m || !m.enabled || !m.metaEvent) return null;
  return m.metaEvent;
}

// Enterprise Follow-up Engine — the deterministic "what should happen next
// on this lead" calculation. Pure functions over state the caller already
// fetched: NO database access here, so embedding the result in an existing
// response (the Lead Workspace detail route) costs one indexed callback
// lookup and zero extra round trips, and the logic is trivially unit-testable.
//
// Distinct from the AI insights recommendation (lib/ai/next-best-action):
// that is a scoring heuristic; this is the OPERATIONAL rule the workspace
// displays as marching orders — always present, always explainable, derived
// only from disposition, callbacks and timestamps.
import { isWonDisposition, isLostDisposition } from "@/lib/dispositions/taxonomy";

export type FollowUpPriority = "urgent" | "high" | "normal" | "low";

export type FollowUp = {
  nextAction: string;
  // When it should happen. Null = nothing scheduled/expected (closed leads).
  dueAt: string | null;
  priority: FollowUpPriority;
  // Why the engine says so — shown as the card's secondary line.
  reason: string;
  // Coarse due bucket for visual indicators: overdue | today | tomorrow |
  // upcoming | none.
  dueBucket: "overdue" | "today" | "tomorrow" | "upcoming" | "none";
};

export type FollowUpLeadState = {
  disposition: string;
  createdAt: Date;
  updatedAt: Date;
  followUpAt: Date | null;
  priority: string; // lead routing priority ("high" | "normal")
};

export type OpenCallbackState = {
  scheduledAt: Date;
  priority: string; // low | normal | high | urgent
  reason: string;
} | null;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function bucketFor(dueAt: Date | null, now: Date): FollowUp["dueBucket"] {
  if (!dueAt) return "none";
  if (dueAt.getTime() < now.getTime()) return "overdue";
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysAhead = Math.floor((dueAt.getTime() - startOfToday.getTime()) / DAY);
  if (daysAhead <= 0) return "today";
  if (daysAhead === 1) return "tomorrow";
  return "upcoming";
}

// Overdue work outranks everything; due-today outranks the calendar.
function escalate(base: FollowUpPriority, bucket: FollowUp["dueBucket"]): FollowUpPriority {
  if (bucket === "overdue") return "urgent";
  if (bucket === "today" && (base === "normal" || base === "low")) return "high";
  return base;
}

export function computeFollowUp(lead: FollowUpLeadState, openCallback: OpenCallbackState, now: Date = new Date()): FollowUp {
  const finish = (nextAction: string, dueAt: Date | null, base: FollowUpPriority, reason: string): FollowUp => {
    const dueBucket = bucketFor(dueAt, now);
    return { nextAction, dueAt: dueAt ? dueAt.toISOString() : null, priority: escalate(base, dueBucket), reason, dueBucket };
  };

  // 1. A scheduled callback is a promise to the customer — it IS the next
  //    action, whatever the disposition says.
  if (openCallback) {
    const base: FollowUpPriority =
      openCallback.priority === "urgent" ? "urgent" : openCallback.priority === "high" ? "high" : openCallback.priority === "low" ? "low" : "normal";
    return finish("Call the customer back", openCallback.scheduledAt, base, openCallback.reason || "Scheduled callback");
  }

  const d = lead.disposition;

  // 2. Closed leads need nothing — except a won sale with an installation
  //    date still on the calendar.
  if (isWonDisposition(d)) {
    if (lead.followUpAt && lead.followUpAt.getTime() > now.getTime() - 30 * DAY) {
      return finish("Confirm installation", lead.followUpAt, "high", "Installation date on file");
    }
    return finish("None — sale closed", null, "low", "Lead is won");
  }
  if (isLostDisposition(d) || d === "Do Not Call" || d === "Invalid Lead") {
    return finish("None — lead closed", null, "low", `Marked "${d}"`);
  }

  // 3. A promised callback ("Call Back Later" / "Call Back") without an
  //    actual callback on the books is a broken promise in the making.
  if (d === "Call Back Later" || d === "Call Back" || d === "Follow-up Scheduled") {
    if (lead.followUpAt) return finish("Follow up as planned", lead.followUpAt, "high", "Follow-up date on file");
    return finish("Schedule the promised callback", now, "urgent", `Disposition is "${d}" but no callback is scheduled`);
  }

  // 4. Untouched new lead: speed-to-lead. Due one hour after arrival.
  if (d === "New Lead") {
    const due = new Date(lead.createdAt.getTime() + HOUR);
    return finish("Make first contact", due, lead.priority === "high" ? "urgent" : "high", "New lead — first response time matters most");
  }

  // 5. Contact attempted but not reached: retry on a short clock.
  if (d === "No Answer" || d === "Busy" || d === "Voicemail Left" || d === "Disconnected") {
    const due = new Date(lead.updatedAt.getTime() + 3 * HOUR);
    return finish("Retry the call", due, "normal", `Last attempt ended "${d}"`);
  }
  if (d === "Hung Up") {
    const due = new Date(lead.updatedAt.getTime() + 2 * DAY);
    return finish("Retry with a different approach", due, "low", "Customer hung up on the last attempt");
  }
  if (d === "Wrong Number") {
    return finish("Find a correct number", null, "low", "Phone on file is wrong — do not redial it");
  }

  // 6. Live interest: keep momentum inside a day.
  if (d === "Interested") {
    const due = lead.followUpAt ?? new Date(lead.updatedAt.getTime() + DAY);
    return finish("Continue the conversation", due, "high", "Customer showed interest");
  }

  // 7. Anything else (custom dispositions): generic nudge off last activity.
  const due = lead.followUpAt ?? new Date(lead.updatedAt.getTime() + 2 * DAY);
  return finish("Follow up", due, lead.priority === "high" ? "high" : "normal", `Currently "${d}"`);
}

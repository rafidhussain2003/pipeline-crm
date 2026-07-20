// Phase 9 — the classification/derivation layer. Turns the raw score + signals
// (from the EXISTING deterministic engine in src/lib/ai) into the customer-
// facing insight: a temperature + headline label, non-exclusive tags, a
// human next-best-action, a follow-up moment, a plain-language summary, and an
// ordered "why" explanation. Every output is deterministic and explainable —
// no LLM, no generative text (per the phase's "explain WHY / no chat" rules).
import type { LeadScore } from "@/lib/ai/lead-scoring";
import type { NextAction } from "@/lib/ai/next-best-action";
import { isWonDisposition } from "@/lib/analytics/kpis";
import { LOST_DISPOSITIONS } from "@/lib/dispositions/taxonomy";
import type { InsightSignals } from "./signals";
import { sourceLabel } from "./signals";

export type Temperature = "hot" | "warm" | "cold";

// Phase 9 action keys — a superset that maps the existing engine's NextAction
// onto the recommendation vocabulary this phase specifies (Call Immediately,
// Schedule Follow-up, Assign Senior Agent, Escalate, Recycle, Archive, ...).
export type InsightAction =
  | "call_now"
  | "send_email"
  | "schedule_follow_up"
  | "assign_agent"
  | "assign_senior"
  | "escalate"
  | "recycle"
  | "archive"
  | "no_action";

export type Recommendation = { action: InsightAction; label: string; reason: string };
export type FollowUp = { followUpAt: Date | null; label: string };

const NEGATIVE_TERMINAL = new Set(LOST_DISPOSITIONS);

export function temperatureOf(score: number): Temperature {
  if (score >= 70) return "hot";
  if (score >= 45) return "warm";
  return "cold";
}

function ageDays(from: Date): number {
  return (Date.now() - from.getTime()) / 86_400_000;
}

// Headline label. Mostly Hot/Warm/Cold, with a couple of specific standouts.
export function scoreLabelOf(score: number, temp: Temperature, s: InsightSignals): string {
  if (isWonDisposition(s.disposition)) return "Won";
  if (score >= 85 && s.hasPhone && ageDays(s.createdAt) < 1) return "Very High Potential";
  return temp === "hot" ? "Hot" : temp === "warm" ? "Warm" : "Cold";
}

// Non-exclusive descriptor tags. Each has a reason surfaced in the explanation.
export function tagsOf(score: number, temp: Temperature, s: InsightSignals): string[] {
  const tags: string[] = [];
  if (isWonDisposition(s.disposition)) tags.push("Won");
  if (NEGATIVE_TERMINAL.has(s.disposition)) tags.push("Closed");
  if (s.isDuplicate) tags.push("Returning Customer");
  if (s.priority === "high" || (temp === "hot" && s.hasPhone && !isWonDisposition(s.disposition))) tags.push("High Value");
  if (s.sourcePlatform === "website" && s.submittedInBusinessHours && ageDays(s.createdAt) < 1) tags.push("High Intent");
  if ((s.recycleCount >= 2 || ageDays(s.lastActivityAt) > 7) && !isWonDisposition(s.disposition) && !NEGATIVE_TERMINAL.has(s.disposition)) {
    tags.push("Low Response Probability");
  }
  return [...new Set(tags)];
}

// Derive the human recommendation. Starts from the existing engine's base
// NextAction and refines it with the richer Phase 9 signals. Recommendation
// ONLY — nothing acts on it.
export function deriveRecommendation(base: NextAction, baseReason: string, score: number, temp: Temperature, tags: string[], s: InsightSignals): Recommendation {
  if (s.isBlacklisted) return { action: "archive", label: "Archive", reason: "Lead is blacklisted from auto-assignment — archive or handle manually." };
  if (isWonDisposition(s.disposition)) return { action: "no_action", label: "No action needed", reason: "Lead is already won." };
  if (NEGATIVE_TERMINAL.has(s.disposition)) return { action: "archive", label: "Archive", reason: `Lead is marked "${s.disposition}" — archive unless it is recycled.` };

  const returningOrHighValue = tags.includes("Returning Customer") || tags.includes("High Value");

  switch (base) {
    case "call_now":
      return { action: "call_now", label: "Call Immediately", reason: baseReason };
    case "send_email":
      return { action: "send_email", label: "Send Email", reason: baseReason };
    case "escalate":
      return { action: "escalate", label: "Escalate", reason: baseReason };
    case "recycle":
      return { action: "recycle", label: "Recycle", reason: baseReason };
    case "assign_to_another_agent":
      return returningOrHighValue
        ? { action: "assign_senior", label: "Assign Senior Agent", reason: `${baseReason} This is a ${tags.includes("Returning Customer") ? "returning" : "high-value"} lead — route it to a senior agent.` }
        : { action: "assign_agent", label: "Assign an Agent", reason: baseReason };
    case "send_sms":
      return { action: "send_email", label: "Send Email", reason: baseReason };
    case "wait":
    default:
      // "Wait" from the base engine, but the lead is still open — turn it into
      // a concrete, scheduled follow-up rather than "do nothing".
      return { action: "schedule_follow_up", label: "Schedule Follow-up", reason: baseReason || "No urgent signals — schedule a follow-up so it isn't forgotten." };
  }
}

function nextMorning(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}

// Recommended follow-up moment + its label. Honors an already-set lead
// followUpAt (overdue / future reminder); otherwise derives from temperature.
export function deriveFollowUp(rec: Recommendation, temp: Temperature, s: InsightSignals): FollowUp {
  if (rec.action === "archive" || rec.action === "no_action") return { followUpAt: null, label: "No follow-up needed" };

  if (s.followUpAt) {
    return s.followUpAt.getTime() < Date.now()
      ? { followUpAt: s.followUpAt, label: "Reminder overdue" }
      : { followUpAt: s.followUpAt, label: "Future reminder" };
  }

  const fresh = ageDays(s.createdAt) < 1;
  if (temp === "hot" && s.hasPhone && fresh) return { followUpAt: new Date(Date.now() + 5 * 60_000), label: "Call within 5 minutes" };
  if (temp === "hot") return { followUpAt: new Date(Date.now() + 60 * 60_000), label: "Call within the hour" };
  if (temp === "warm") return { followUpAt: nextMorning(), label: "Call tomorrow morning" };
  return { followUpAt: new Date(Date.now() + 3 * 86_400_000), label: "Follow up in 3 days" };
}

// A plain-language summary sentence, composed from the signals (source, intent,
// timing, returning). Mirrors the phase's examples without any generation.
export function composeSummary(s: InsightSignals, tags: string[]): string {
  const src = sourceLabel(s);
  const parts: string[] = [];

  if (tags.includes("Returning Customer")) {
    parts.push(`Returning customer${s.name ? ` (${s.name})` : ""} — this matches an earlier inquiry`);
  } else if (tags.includes("High Intent")) {
    parts.push(`High-intent lead${s.name ? ` ${s.name}` : ""} submitted a website form during business hours`);
  } else {
    const timing = ageDays(s.createdAt) < 1 ? " today" : "";
    parts.push(`${s.name || "Lead"} submitted an inquiry from ${src}${timing}`);
  }

  if (isWonDisposition(s.disposition)) parts.push("and has been won");
  else if (NEGATIVE_TERMINAL.has(s.disposition)) parts.push(`and is currently "${s.disposition}"`);
  else if (s.ownerName) parts.push(`currently with ${s.ownerName} at "${s.disposition}"`);
  else parts.push(`awaiting assignment at "${s.disposition}"`);

  return parts.join(", ").replace(/,\s*and/g, " and") + ".";
}

// The "why": an ordered list of short, human reason strings. Always explains
// the score — never shows a number alone.
export function composeExplanation(score: LeadScore, label: string, temp: Temperature, tags: string[], rec: Recommendation, s: InsightSignals): string[] {
  const why: string[] = [];
  const topFactor = [...score.factors].filter((f) => f.maxPoints > 0).sort((a, b) => b.points - a.points)[0];

  why.push(`Scored ${score.score}/100 (${label})${topFactor ? ` — strongest signal: ${topFactor.reason.toLowerCase()}` : ""}.`);

  if (s.hasPhone && s.hasEmail) why.push("Phone and email are both present, so the lead is directly reachable.");
  else if (s.hasPhone) why.push("A phone number is present — a direct call is possible.");
  else if (s.hasEmail) why.push("Only an email is present — no phone number to call.");
  else why.push("No phone or email captured — reachability is limited.");

  if (tags.includes("Returning Customer")) why.push("Marked a returning customer because it matches an earlier inquiry for this company.");
  if (tags.includes("High Intent")) why.push("Marked high intent because it came from a website form submitted during business hours.");
  if (tags.includes("Low Response Probability")) {
    why.push(
      s.recycleCount >= 2
        ? `Low response probability because it has been recycled ${s.recycleCount} time(s).`
        : `Low response probability because there has been no activity in ${Math.round(ageDays(s.lastActivityAt))} day(s).`
    );
  }
  if (s.priority === "high") why.push("Flagged high priority, which raises its value regardless of score.");

  why.push(`Recommended action: ${rec.label} — ${rec.reason}`);
  return why;
}

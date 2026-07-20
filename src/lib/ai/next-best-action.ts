// Next best action (Part 3) — deterministic rules over the same
// LeadContext used for scoring, not an LLM call. Every recommendation
// states its reasoning, same explainability requirement as scoring.
import { buildLeadContext } from "./context";
import { scoreLead } from "./lead-scoring";
import { isWonDisposition } from "../analytics/kpis";
import { isLostDisposition } from "@/lib/dispositions/taxonomy";

export type NextAction = "call_now" | "send_email" | "send_sms" | "recycle" | "escalate" | "assign_to_another_agent" | "wait";

export type NextActionRecommendation = {
  leadId: string;
  action: NextAction;
  reasoning: string;
};

const STALE_DAYS_THRESHOLD = 3;
const VERY_STALE_DAYS_THRESHOLD = 10;

export async function recommendNextAction(leadId: string): Promise<NextActionRecommendation | null> {
  const context = await buildLeadContext(leadId);
  if (!context) return null;

  if (isWonDisposition(context.disposition)) {
    return { leadId, action: "wait", reasoning: "Lead is already won — no action needed." };
  }
  if (isLostDisposition(context.disposition)) {
    return { leadId, action: "wait", reasoning: `Lead is marked "${context.disposition}" — leave it unless recycled by automation.` };
  }

  const daysSinceUpdate = (Date.now() - context.updatedAt.getTime()) / (1000 * 60 * 60 * 24);
  const daysSinceCreated = (Date.now() - context.createdAt.getTime()) / (1000 * 60 * 60 * 24);

  if (!context.ownerId) {
    return { leadId, action: "assign_to_another_agent", reasoning: "Lead has no owner — needs to be assigned before anything else can happen." };
  }

  if (context.disposition === "New Lead" && daysSinceCreated < 1) {
    return { leadId, action: "call_now", reasoning: "Fresh lead, still in the first 24 hours — response speed matters most right now." };
  }

  if (context.reassignmentCount >= 3 && daysSinceUpdate > STALE_DAYS_THRESHOLD) {
    return {
      leadId,
      action: "escalate",
      reasoning: `Reassigned ${context.reassignmentCount} times and still stale after ${Math.round(daysSinceUpdate)} day(s) — needs supervisor attention, not another reassignment.`,
    };
  }

  if (daysSinceUpdate > VERY_STALE_DAYS_THRESHOLD) {
    return {
      leadId,
      action: "recycle",
      reasoning: `No activity in ${Math.round(daysSinceUpdate)} day(s) — recycle to a different agent rather than leaving it stalled.`,
    };
  }

  if (daysSinceUpdate > STALE_DAYS_THRESHOLD) {
    const score = await scoreLead(leadId);
    if (score && score.score >= 60) {
      return {
        leadId,
        action: "call_now",
        reasoning: `High lead score (${score.score}/100) but ${Math.round(daysSinceUpdate)} day(s) since last activity — worth a direct call before it goes cold.`,
      };
    }
    return {
      leadId,
      action: "send_email",
      reasoning: `${Math.round(daysSinceUpdate)} day(s) since last activity — a follow-up email is a lower-effort nudge than a call for this lead's current score.`,
    };
  }

  if (context.noteCount === 0) {
    return { leadId, action: "call_now", reasoning: "No notes recorded yet — first contact hasn't been logged." };
  }

  return { leadId, action: "wait", reasoning: "Lead was touched recently and has no stale/escalation signals — no action needed right now." };
}

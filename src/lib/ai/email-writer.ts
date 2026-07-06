// AI email writer (Part 5). Tries the AI provider for a natural, tailored
// draft; falls back to the plain (non-AI) template from
// src/lib/email/templates.ts when no provider is configured (true today)
// — the email still gets written, just without AI phrasing, rather than
// the feature simply not working.
import { buildLeadContext } from "./context";
import { getActiveProvider } from "./config";
import { renderPrompt } from "./prompts";
import { renderEmailTemplate } from "../email/templates";
import { metrics } from "../infra/metrics";

export type DraftEmailResult = {
  leadId: string;
  subject: string;
  body: string;
  usedAI: boolean;
};

export async function draftFollowUpEmail(leadId: string, agentName: string): Promise<DraftEmailResult | null> {
  const context = await buildLeadContext(leadId);
  if (!context) return null;

  const daysSinceUpdate = Math.round((Date.now() - context.updatedAt.getTime()) / (1000 * 60 * 60 * 24));
  const leadName = context.name || "there";

  const provider = getActiveProvider();
  const prompt = renderPrompt("follow_up_email", {
    leadName,
    disposition: context.disposition,
    daysSinceUpdate: String(daysSinceUpdate),
    agentName,
  });
  const result = await provider.complete({ prompt, maxTokens: 200 });

  if (result.success && result.text) {
    return { leadId, subject: `Following up, ${leadName}`, body: result.text, usedAI: true };
  }

  metrics.increment("ai.fallback_used");
  const template = renderEmailTemplate("lead_follow_up", { leadName, agentName });
  return { leadId, subject: template.subject, body: template.html, usedAI: false };
}

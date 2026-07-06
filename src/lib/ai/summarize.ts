// Summarization (Part 6). Tries the configured AI provider for a real
// prose summary; when none is configured (true today), falls back to a
// structured digest built directly from the same LeadContext — genuinely
// useful on its own (an agent can read it at a glance), not a placeholder
// error message. The `usedAI` flag tells the caller which one it got.
import { buildLeadContext, type LeadContext } from "./context";
import { getActiveProvider } from "./config";
import { renderPrompt } from "./prompts";
import { metrics } from "../infra/metrics";

export type LeadSummaryResult = {
  leadId: string;
  summary: string;
  usedAI: boolean;
};

function structuredDigest(context: LeadContext): string {
  const parts = [
    `${context.name || "Unnamed lead"} — currently "${context.disposition}"`,
    context.ownerName ? `assigned to ${context.ownerName}` : "unassigned",
    `${context.noteCount} note(s)`,
    context.tagLabels.length > 0 ? `tagged: ${context.tagLabels.join(", ")}` : null,
    context.latestNote ? `latest note: "${context.latestNote}"` : null,
  ].filter((p): p is string => p !== null);
  return parts.join(". ") + ".";
}

export async function summarizeLead(leadId: string): Promise<LeadSummaryResult | null> {
  const context = await buildLeadContext(leadId);
  if (!context) return null;

  const provider = getActiveProvider();
  const prompt = renderPrompt("lead_summary", {
    name: context.name || "Unnamed lead",
    disposition: context.disposition,
    source: context.sourceId ? "a connected lead source" : "manual entry",
    createdAt: context.createdAt.toISOString(),
    notes: context.latestNote || "none",
  });
  const result = await provider.complete({ prompt, maxTokens: 150 });

  if (result.success && result.text) {
    return { leadId, summary: result.text, usedAI: true };
  }
  metrics.increment("ai.fallback_used");
  return { leadId, summary: structuredDigest(context), usedAI: false };
}

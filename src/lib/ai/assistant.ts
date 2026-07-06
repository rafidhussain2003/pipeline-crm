// AI CRM assistant (Part 4). Without a real LLM configured, "natural
// language search" can't be true NLU — this uses simple keyword matching
// to route a handful of common question shapes to real, existing
// analytics/service functions (genuinely useful today, not a placeholder).
// Anything that doesn't match a known shape falls through to the AI
// provider directly, which honestly reports "not configured" rather than
// this module pretending to understand a question it can't.
import { getConversionFunnel, getLeadSummary, getAgentStats } from "../analytics/service";
import { resolveDateRange } from "../analytics/range";
import { getActiveProvider } from "./config";
import { appendConversationTurn } from "./memory";
import { metrics } from "../infra/metrics";

export type AssistantAnswer = {
  answer: string;
  usedAI: boolean;
  matchedIntent: string | null;
};

export async function askAssistant(userId: string, companyId: string, question: string): Promise<AssistantAnswer> {
  await appendConversationTurn(userId, { role: "user", content: question, at: new Date().toISOString() });

  const normalized = question.toLowerCase();
  const range = resolveDateRange("week");
  let answer: AssistantAnswer;

  if (/how many leads/.test(normalized)) {
    const summary = await getLeadSummary(companyId, range);
    answer = { answer: `${summary.total} lead(s) in the last 7 days.`, usedAI: false, matchedIntent: "lead_count" };
  } else if (/conversion/.test(normalized)) {
    const funnel = await getConversionFunnel(companyId, range);
    answer = {
      answer: `Conversion rate over the last 7 days is ${funnel.conversionRatePct}% (${funnel.wonCount}/${funnel.totalCount} leads won).`,
      usedAI: false,
      matchedIntent: "conversion_rate",
    };
  } else if (/(top performer|best agent|top agent)/.test(normalized)) {
    const stats = await getAgentStats(companyId, range);
    const top = stats.topPerformers[0];
    answer = {
      answer: top
        ? `${top.name} is the top performer this week: ${top.leadsHandled} lead(s) handled, ${top.leadsWon} won.`
        : "No agent activity recorded in the last 7 days.",
      usedAI: false,
      matchedIntent: "top_performer",
    };
  } else {
    const provider = getActiveProvider();
    const result = await provider.complete({ prompt: question, maxTokens: 200 });
    if (result.success && result.text) {
      answer = { answer: result.text, usedAI: true, matchedIntent: null };
    } else {
      metrics.increment("ai.fallback_used");
      answer = {
        answer:
          "I can answer questions about lead counts, conversion rate, and top performers today. Free-form questions need an AI provider, which isn't configured yet.",
        usedAI: false,
        matchedIntent: null,
      };
    }
  }

  await appendConversationTurn(userId, { role: "assistant", content: answer.answer, at: new Date().toISOString() });
  return answer;
}

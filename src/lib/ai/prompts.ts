// Reuses the exact same `{{variable}}` renderer already built for email
// templates (src/lib/email/templates.ts) instead of a second templating
// mechanism — the underlying need (fill placeholders in a string) is
// identical, so a second implementation here would just be duplication.
import { renderTemplate } from "../email/templates";

export type PromptName =
  | "lead_summary"
  | "company_summary"
  | "follow_up_email"
  | "next_best_action_explanation";

const PROMPTS: Record<PromptName, string> = {
  lead_summary:
    "Summarize this CRM lead in 2-3 sentences for a sales agent. Name: {{name}}. Disposition: {{disposition}}. Source: {{source}}. Created: {{createdAt}}. Notes: {{notes}}.",
  company_summary:
    "Summarize this company's CRM activity in 2-3 sentences. Company: {{companyName}}. Total leads: {{totalLeads}}. Active agents: {{activeAgents}}. Conversion rate: {{conversionRate}}%.",
  follow_up_email:
    "Write a short, friendly follow-up email to a lead named {{leadName}} who has been in the \"{{disposition}}\" stage for {{daysSinceUpdate}} days. Sign off as {{agentName}}.",
  next_best_action_explanation:
    "In one sentence, explain to a sales agent why the recommended next action for lead {{leadName}} is \"{{action}}\", given: {{reasoning}}.",
};

export function renderPrompt(name: PromptName, data: Record<string, string>): string {
  return renderTemplate(PROMPTS[name], data);
}

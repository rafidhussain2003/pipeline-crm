// Minimal template rendering: `{{variable}}` substitution. No templating
// engine dependency (Handlebars/EJS/etc.) — the templates below are simple
// enough that regex substitution is sufficient, and it avoids adding a new
// dependency for what is currently zero real email sends (no provider is
// configured; see provider.ts).
export function renderTemplate(template: string, data: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => (key in data ? data[key] : match));
}

export type EmailTemplateName = "invitation" | "password_changed" | "lead_assigned" | "lead_follow_up";

const TEMPLATES: Record<EmailTemplateName, { subject: string; html: string }> = {
  invitation: {
    subject: "You've been invited to join {{companyName}} on Pipeline",
    html: "<p>Hi {{name}},</p><p>{{inviterName}} has invited you to join <strong>{{companyName}}</strong> on Pipeline.</p>",
  },
  password_changed: {
    subject: "Your password was changed",
    html: "<p>Hi {{name}},</p><p>Your password was just changed. If this wasn't you, contact your admin immediately.</p>",
  },
  lead_assigned: {
    subject: "New lead assigned: {{leadName}}",
    html: "<p>Hi {{name}},</p><p>A new lead, <strong>{{leadName}}</strong>, has been assigned to you.</p>",
  },
  // Plain-template fallback for the AI email writer (src/lib/ai/email-writer.ts)
  // when no AI provider is configured — sent TO the lead, unlike
  // lead_assigned (a notification TO the agent), so it can't reuse that one.
  lead_follow_up: {
    subject: "Following up, {{leadName}}",
    html: "<p>Hi {{leadName}},</p><p>Just following up to see if you're still interested. Let me know if you have any questions!</p><p>Best,<br>{{agentName}}</p>",
  },
};

export function renderEmailTemplate(name: EmailTemplateName, data: Record<string, string>): { subject: string; html: string } {
  const template = TEMPLATES[name];
  return {
    subject: renderTemplate(template.subject, data),
    html: renderTemplate(template.html, data),
  };
}

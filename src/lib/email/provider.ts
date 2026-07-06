// Email provider abstraction. No provider is configured today (no
// SendGrid/Resend/Postmark/SES dependency anywhere in package.json) — this
// is intentionally NOT added here, since picking and paying for an email
// provider is a product/infra decision, not something to introduce as a
// side effect of a code-quality pass. `ConsoleEmailProvider` logs what
// would have been sent (visible in Render logs) so the call sites and
// templates below are fully exercised and testable today; swapping in a
// real provider later means writing one class implementing `EmailProvider`
// — no caller changes.
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailSendResult {
  success: boolean;
  reason?: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<EmailSendResult>;
}

class ConsoleEmailProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<EmailSendResult> {
    console.log(`[email:not-sent] to=${message.to} subject="${message.subject}" (no email provider configured)`);
    return { success: false, reason: "No email provider configured" };
  }
}

export const emailProvider: EmailProvider = new ConsoleEmailProvider();

// SMS provider abstraction — same pattern and same reasoning as
// src/lib/email/provider.ts: no real provider (Twilio, etc.) is
// configured, so this logs instead of sending. Covers OTP, workflow
// messages, assignment alerts, and general notifications per Part 4 — all
// of those are just "send this text to this phone number" at the provider
// boundary; the different use cases are about what calls `send()` and with
// what message, not a different interface.
export interface SmsMessage {
  to: string;
  body: string;
}

export interface SmsSendResult {
  success: boolean;
  reason?: string;
}

export interface SmsProvider {
  send(message: SmsMessage): Promise<SmsSendResult>;
}

class ConsoleSmsProvider implements SmsProvider {
  async send(message: SmsMessage): Promise<SmsSendResult> {
    console.log(`[sms:not-sent] to=${message.to} (no SMS provider configured)`);
    return { success: false, reason: "No SMS provider configured" };
  }
}

export const smsProvider: SmsProvider = new ConsoleSmsProvider();

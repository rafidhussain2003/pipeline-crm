export type NotificationChannel = "in_app" | "email" | "sms" | "webhook" | "push";

export type NotificationInput = {
  companyId: string;
  userId: string;
  type: string; // e.g. "lead.assigned" — matches the event type that triggered it, when applicable
  title: string;
  body?: string;
  channel?: NotificationChannel; // defaults to "in_app"
  metadata?: Record<string, unknown>;
};

// Phase 15 — reminder delivery channels. THE FUTURE-READY SEAM.
//
// A reminder row carries a `channel`; the worker looks the channel up here and
// calls deliver(). Only "in_app" is implemented today (real-time SSE push +
// a durable notification row). Email / SMS / WhatsApp / Voice / Calendar are
// declared in the type and resolve to a NotImplemented channel that reports an
// honest reason instead of silently succeeding — adding one later means writing
// ONE class and registering it here. No schema change, no worker change, no
// call-site change.
import { db } from "@/db";
import { leads } from "@/db/schema";
import { eq } from "drizzle-orm";
import { sendNotification } from "@/lib/notifications/service";
import { callbackHub } from "./hub";
import { labelForKind, type CallbackChannel, type CallbackReminderPayload } from "./types";

export interface DeliverInput {
  callbackId: string;
  companyId: string;
  agentId: string;
  leadId: string;
  kind: string;
  scheduledAt: Date;
  reason: string;
  priority: string;
  priorityScore: number;
  status: string;
}
export type DeliverResult = { ok: true } | { ok: false; reason: string };

export interface ReminderChannel {
  readonly name: CallbackChannel;
  deliver(input: DeliverInput): Promise<DeliverResult>;
}

// ── in_app: real-time push + a durable notification ─────────────────────────
// The SSE push is instant but ephemeral (only reaches a connected tab); the
// notification row is what makes the reminder survive a reload/logout, so the
// banner can be re-shown until the agent acknowledges it.
class InAppChannel implements ReminderChannel {
  readonly name: CallbackChannel = "in_app";

  async deliver(input: DeliverInput): Promise<DeliverResult> {
    try {
      const [lead] = await db.select({ name: leads.name }).from(leads).where(eq(leads.id, input.leadId)).limit(1);
      const label = labelForKind(input.kind);
      const payload: CallbackReminderPayload = {
        callbackId: input.callbackId,
        leadId: input.leadId,
        leadName: lead?.name ?? null,
        kind: input.kind,
        label,
        scheduledAt: input.scheduledAt.toISOString(),
        reason: input.reason,
        priority: input.priority as CallbackReminderPayload["priority"],
        priorityScore: input.priorityScore,
        status: input.status as CallbackReminderPayload["status"],
        at: new Date().toISOString(),
      };
      // Push to any live tab for this agent (no polling).
      callbackHub.publish(input.agentId, payload);
      // Durable copy so it survives a refresh / offline agent.
      await sendNotification({
        companyId: input.companyId,
        userId: input.agentId,
        type: "callback.reminder",
        title: label,
        body: `${lead?.name || "Lead"} — ${input.reason}`,
        metadata: { callbackId: input.callbackId, leadId: input.leadId, kind: input.kind },
      }).catch(() => {});
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : "in_app delivery failed" };
    }
  }
}

// Any channel that isn't wired yet: honest failure, never a silent success.
class NotImplementedChannel implements ReminderChannel {
  constructor(readonly name: CallbackChannel) {}
  async deliver(): Promise<DeliverResult> {
    return { ok: false, reason: `The "${this.name}" reminder channel is not implemented yet.` };
  }
}

const REGISTRY: Record<CallbackChannel, ReminderChannel> = {
  in_app: new InAppChannel(),
  email: new NotImplementedChannel("email"),
  sms: new NotImplementedChannel("sms"),
  whatsapp: new NotImplementedChannel("whatsapp"),
  voice: new NotImplementedChannel("voice"),
  calendar: new NotImplementedChannel("calendar"),
};

export function getChannel(name: string): ReminderChannel {
  return REGISTRY[name as CallbackChannel] ?? REGISTRY.in_app;
}

// Which channels actually deliver today — used by the settings UI/diagnostics.
export function implementedChannels(): CallbackChannel[] {
  return (Object.keys(REGISTRY) as CallbackChannel[]).filter((c) => !(REGISTRY[c] instanceof NotImplementedChannel));
}

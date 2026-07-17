// Phase 15 — append-only callback history. Every meaningful thing that happens
// to a callback lands here (created / rescheduled / completed / cancelled /
// missed / viewed / acknowledged / reminder_sent / escalated), giving each
// callback its own timeline alongside the company-wide audit_log. Kept in its
// own file so both the service and the reminder worker can write to it without
// importing each other.
import { db } from "@/db";
import { callbackEvents } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";

export type CallbackEventType =
  | "created"
  | "rescheduled"
  | "completed"
  | "cancelled"
  | "missed"
  | "viewed"
  | "acknowledged"
  | "reminder_sent"
  | "escalated";

// Best-effort: history must never fail the action it describes.
export async function recordCallbackEvent(params: {
  callbackId: string;
  companyId: string;
  type: CallbackEventType;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(callbackEvents).values({
      callbackId: params.callbackId,
      companyId: params.companyId,
      type: params.type,
      actorUserId: params.actorUserId ?? null,
      metadata: params.metadata ?? null,
    });
  } catch (err) {
    console.error("Failed to record callback event:", err);
  }
}

export async function getCallbackHistory(callbackId: string, companyId: string) {
  return db
    .select({ id: callbackEvents.id, type: callbackEvents.type, actorUserId: callbackEvents.actorUserId, metadata: callbackEvents.metadata, createdAt: callbackEvents.createdAt })
    .from(callbackEvents)
    .where(and(eq(callbackEvents.callbackId, callbackId), eq(callbackEvents.companyId, companyId)))
    .orderBy(asc(callbackEvents.createdAt));
}

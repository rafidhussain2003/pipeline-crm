import { db } from "@/db";
import { auditLog } from "@/db/schema";

export async function recordAudit(params: {
  companyId: string | null;
  userId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  // Structured before/after state and the originating request ID — all
  // stored inside the existing `metadata` jsonb column rather than adding
  // dedicated schema columns, so this is a purely additive change with no
  // migration required. Every param here is optional so existing call
  // sites that only pass `metadata` keep working unchanged.
  before?: unknown;
  after?: unknown;
  requestId?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    const composedMetadata: Record<string, unknown> = {
      ...(params.before !== undefined ? { before: params.before } : {}),
      ...(params.after !== undefined ? { after: params.after } : {}),
      ...(params.requestId ? { requestId: params.requestId } : {}),
      ...(params.metadata || {}),
    };

    await db.insert(auditLog).values({
      companyId: params.companyId,
      userId: params.userId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId || null,
      // Preserve the original behavior of storing `null` (not `{}`) when
      // there's nothing to record — some UI code may check truthiness of
      // this field, and `{}` is truthy where `null` isn't.
      metadata: Object.keys(composedMetadata).length > 0 ? composedMetadata : null,
    });
  } catch (err) {
    // Audit logging must never break the primary request.
    console.error("Failed to write audit log:", err);
  }
}

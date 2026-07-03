import { db } from "@/db";
import { auditLog } from "@/db/schema";

export async function recordAudit(params: {
  companyId: string | null;
  userId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  try {
    await db.insert(auditLog).values({
      companyId: params.companyId,
      userId: params.userId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId || null,
      metadata: params.metadata || null,
    });
  } catch (err) {
    // Audit logging must never break the primary request.
    console.error("Failed to write audit log:", err);
  }
}

// Single write path for every row on the Delivery Log page. Both webhook
// receivers (Facebook and the generic/universal one) call this exactly
// once per inbound event, whatever the outcome — success, failure, or an
// intentional no-op (disabled form, duplicate delivery, disconnected
// source). Nothing about lead delivery should ever be diagnosable only
// from server console output; if it happened, it's a row here.
import { db } from "@/db";
import { webhookLogs } from "@/db/schema";

export type DeliveryStage = "received" | "lead_downloaded" | "lead_stored" | "lead_assigned" | "completed";
export type DeliveryStatus = "success" | "failed" | "retried" | "skipped";

export async function recordDeliveryLog(params: {
  sourceId: string | null;
  companyId: string | null;
  status: DeliveryStatus;
  // The last pipeline stage actually reached. For a "success" row this is
  // always "completed"; for "failed"/"skipped" it's where processing
  // stopped — see webhookStageEnum in db/schema.ts.
  stage: DeliveryStage;
  // Date.now() captured at the top of this event's processing — used to
  // compute processingTimeMs here rather than at every call site.
  startedAt: number;
  leadId?: string | null;
  formId?: string | null;
  payload?: unknown;
  error?: string | null;
  // Time between the provider's own event timestamp and our receipt of
  // it, when the provider supplies one (Meta's entry.time does).
  webhookLatencyMs?: number | null;
}): Promise<void> {
  await db.insert(webhookLogs).values({
    sourceId: params.sourceId,
    companyId: params.companyId,
    status: params.status,
    stage: params.stage,
    leadId: params.leadId ?? null,
    formId: params.formId ?? null,
    payload: (params.payload as object | undefined) ?? null,
    error: params.error ?? null,
    processingTimeMs: Date.now() - params.startedAt,
    webhookLatencyMs: params.webhookLatencyMs ?? null,
  });
}

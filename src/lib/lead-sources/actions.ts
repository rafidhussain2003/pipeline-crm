// Shared per-source actions (sync one Page, disconnect one Page) — the
// building blocks both the per-page routes (api/lead-sources/[id]/*) and
// the account-level bulk routes (api/lead-sources/accounts/[id]/*) call.
// Kept here once instead of duplicated so "sync a page" and "disconnect a
// page" have exactly one real implementation each, no matter how many
// pages a bulk action loops over.
import { db } from "@/db";
import { leadSources, leadForms } from "@/db/schema";
import { eq } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { getProvider } from "@/lib/lead-sources/registry";
import { recordAudit } from "@/lib/audit";

export const FRIENDLY_SYNC_ERROR: Record<string, string> = {
  token_expired: "Facebook access expired for this page. Please reconnect.",
  permission_revoked: "A required permission was removed on Facebook's side. Please reconnect.",
  not_found: "This Page no longer exists on Facebook. Please disconnect it.",
  error: "Could not reach Facebook right now. Please try again.",
};

type Source = typeof leadSources.$inferSelect;

// Re-validates a source's stored token against its provider and discovers
// any Lead Ad forms created since it was connected. Newly-discovered forms
// are added disabled by default — same principle as the initial connect,
// a form appearing here can't silently start sending leads without the
// customer explicitly ticking it.
export async function syncOneSource(
  source: Source,
  actor: { userId: string; companyId: string }
): Promise<{ ok: true; newFormsFound: number } | { ok: false; error: string }> {
  const provider = getProvider(source.platform);
  if (!provider || !source.pageId || !source.accessToken) {
    return { ok: false, error: "Sync Now isn't available for this source." };
  }

  try {
    const token = decrypt(source.accessToken);
    const forms = await provider.listForms(source.pageId, token);

    const existing = await db
      .select({ formId: leadForms.formId })
      .from(leadForms)
      .where(eq(leadForms.sourceId, source.id));
    const knownFormIds = new Set(existing.map((f) => f.formId));
    const newForms = forms.filter((f) => !knownFormIds.has(f.id));
    if (newForms.length > 0) {
      await db
        .insert(leadForms)
        .values(newForms.map((f) => ({ sourceId: source.id, formId: f.id, formName: f.name, enabled: false })));
    }

    await db
      .update(leadSources)
      .set({ lastSyncedAt: new Date(), status: "connected", webhookStatus: "active", lastError: null })
      .where(eq(leadSources.id, source.id));

    await recordAudit({
      companyId: actor.companyId,
      userId: actor.userId,
      action: "lead_source.synced",
      entityType: "lead_source",
      entityId: source.id,
      metadata: { newFormsFound: newForms.length },
    });

    return { ok: true, newFormsFound: newForms.length };
  } catch (err) {
    console.error(`Sync Now failed for source ${source.id}:`, err);
    const status = provider.classifyError(err);
    const lastError = err instanceof Error ? err.message : "Unknown provider API error";
    await db.update(leadSources).set({ status, lastError }).where(eq(leadSources.id, source.id));
    return { ok: false, error: FRIENDLY_SYNC_ERROR[status] };
  }
}

// Soft-deletes a source (keeps its leads and history intact) and
// best-effort tells the provider to stop delivering webhook events for it.
// If the unsubscribe call fails (token already revoked, provider outage),
// the disconnect still proceeds: the webhook receiver itself already
// checks status/deletedAt and drops events for a disconnected source, so a
// lingering provider-side subscription can't leak leads back in.
export async function disconnectOneSource(source: Source, actor: { userId: string; companyId: string }) {
  const provider = getProvider(source.platform);
  if (provider && source.pageId && source.accessToken) {
    try {
      await provider.unsubscribeWebhook(source.pageId, decrypt(source.accessToken));
    } catch (err) {
      console.error(`Failed to unsubscribe webhook for source ${source.id} (continuing with disconnect):`, err);
    }
  }

  await db
    .update(leadSources)
    .set({ status: "disconnected", webhookStatus: "inactive", deletedAt: new Date() })
    .where(eq(leadSources.id, source.id));

  await recordAudit({
    companyId: actor.companyId,
    userId: actor.userId,
    action: "lead_source.disconnected",
    entityType: "lead_source",
    entityId: source.id,
    before: { pageName: source.pageName, status: source.status },
  });
}

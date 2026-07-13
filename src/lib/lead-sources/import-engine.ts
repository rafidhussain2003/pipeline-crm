// Historical lead import engine.
//
// Runs as a real in-process async loop (Render runs this app as a normal
// persistent Node process, not serverless) rather than requiring a new
// queue/worker service. Everything the loop needs to resume — which form
// it's on, Meta's pagination cursor — is written to `lead_imports` after
// every single page, because that persistent process still restarts on
// every deploy: an in-memory-only job would silently die and lose all
// progress the moment that happens. Two independent things keep a job
// moving forward without the browser: `kickImport()` (called by the
// progress-polling endpoint, so it advances while someone's watching) and
// `resumeStaleImports()` (called by /api/cron/resume-imports on a
// schedule, so it advances even with nobody watching or after a restart).
import { db } from "@/db";
import { leadImports, leadImportLogs, leadSources, leadForms } from "@/db/schema";
import { and, eq, lt, sql } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { fetchFormLeads } from "@/lib/facebook";
import { getProvider } from "@/lib/lead-sources/registry";
import { ingestLead } from "./ingest-lead";
import { createLogger } from "@/lib/logger";

const logger = createLogger({ component: "lead-import" });

export type ImportRange = "7d" | "30d" | "90d" | "180d" | "365d" | "all";

const RANGE_DAYS: Record<ImportRange, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "180d": 180,
  "365d": 365,
  all: null,
};

type Checkpoint = { formIndex: number; afterCursor: string | null };

const PAGE_SIZE = 100;
const THROTTLE_MS = 300; // spacing between Graph API calls — never hammer the API
const MAX_PAGES_PER_INVOCATION = 300; // ~30k leads/invocation ceiling before yielding
const MAX_DURATION_MS = 4 * 60_000; // yield after 4 minutes regardless, whichever comes first
export const HEARTBEAT_STALE_MINUTES = 3;

// Guards against two loops running for the same import at once — a
// poll-triggered kick and the cron sweep can otherwise race.
const runningImports = new Set<string>();

export async function startImport(params: {
  companyId: string;
  sourceId: string;
  range: ImportRange;
  formIds: string[];
  createdBy: string;
}) {
  const [row] = await db
    .insert(leadImports)
    .values({
      companyId: params.companyId,
      sourceId: params.sourceId,
      range: params.range,
      formIds: params.formIds,
      checkpoint: { formIndex: 0, afterCursor: null } satisfies Checkpoint,
      currentFormId: params.formIds[0] ?? null,
      createdBy: params.createdBy,
    })
    .returning();
  kickImport(row.id);
  return row;
}

// Fire-and-forget — never awaited by a request handler. Safe to call
// repeatedly for the same import; the in-process guard below no-ops a
// second call while one is already running.
export function kickImport(importId: string) {
  if (runningImports.has(importId)) return;
  runningImports.add(importId);
  runLoop(importId)
    .catch((err) => {
      logger.error("import_loop_crashed", { importId, error: err instanceof Error ? err.message : String(err) });
      return db
        .update(leadImports)
        .set({ status: "failed", error: err instanceof Error ? err.message : "Unknown error", lastProcessedAt: new Date() })
        .where(eq(leadImports.id, importId));
    })
    .finally(() => runningImports.delete(importId));
}

async function runLoop(importId: string) {
  const invocationStart = Date.now();
  let pagesThisInvocation = 0;

  while (Date.now() - invocationStart < MAX_DURATION_MS && pagesThisInvocation < MAX_PAGES_PER_INVOCATION) {
    const [job] = await db.select().from(leadImports).where(eq(leadImports.id, importId)).limit(1);
    if (!job || job.status !== "running") return;

    if (job.cancelRequested) {
      await db
        .update(leadImports)
        .set({ status: "cancelled", completedAt: new Date(), lastProcessedAt: new Date() })
        .where(eq(leadImports.id, importId));
      return;
    }

    const formIds = job.formIds as string[];
    const checkpoint = job.checkpoint as Checkpoint;
    if (checkpoint.formIndex >= formIds.length) {
      await db
        .update(leadImports)
        .set({ status: "completed", completedAt: new Date(), lastProcessedAt: new Date() })
        .where(eq(leadImports.id, importId));
      return;
    }

    const [source] = await db.select().from(leadSources).where(eq(leadSources.id, job.sourceId)).limit(1);
    if (!source || !source.accessToken) {
      await db
        .update(leadImports)
        .set({ status: "failed", error: "Source is no longer connected", completedAt: new Date(), lastProcessedAt: new Date() })
        .where(eq(leadImports.id, importId));
      return;
    }

    const formId = formIds[checkpoint.formIndex];
    const [formRow] = await db
      .select({ formName: leadForms.formName })
      .from(leadForms)
      .where(and(eq(leadForms.sourceId, source.id), eq(leadForms.formId, formId)))
      .limit(1);

    const sinceDays = RANGE_DAYS[job.range as ImportRange];
    const sinceUnix = sinceDays ? Math.floor((Date.now() - sinceDays * 86_400_000) / 1000) : null;

    let page;
    try {
      page = await fetchFormLeads(formId, decrypt(source.accessToken), {
        sinceUnix,
        after: checkpoint.afterCursor,
        limit: PAGE_SIZE,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      const errorKind = getProvider("facebook")!.classifyError(err);
      logger.error("import_form_fetch_failed", { importId, formId, error: message, errorKind });

      // A token/permission problem affects every remaining form the same
      // way — retrying form after form against the same broken token would
      // just burn through the rest of the run for nothing. A form-specific
      // problem (deleted form, transient error) only affects this one form.
      if (errorKind === "token_expired" || errorKind === "permission_revoked") {
        await db
          .update(leadImports)
          .set({ status: "failed", error: `Reconnect required: ${message}`, completedAt: new Date(), lastProcessedAt: new Date() })
          .where(eq(leadImports.id, importId));
        return;
      }

      await db
        .update(leadImports)
        .set({
          checkpoint: { formIndex: checkpoint.formIndex + 1, afterCursor: null } satisfies Checkpoint,
          lastProcessedAt: new Date(),
        })
        .where(eq(leadImports.id, importId));
      pagesThisInvocation++;
      await sleep(THROTTLE_MS);
      continue;
    }

    // Progress updates per lead, not just once per page — a page can be up
    // to 100 leads, and batching the counter update until the whole page
    // finishes would make the progress UI look frozen for however long
    // that page takes, which defeats the point of polling live progress.
    await db
      .update(leadImports)
      .set({ totalFound: sql`${leadImports.totalFound} + ${page.leads.length}`, currentFormId: formId, currentFormName: formRow?.formName ?? formId })
      .where(eq(leadImports.id, importId));

    for (const item of page.leads) {
      const startedAt = Date.now();
      try {
        const result = await ingestLead({
          source,
          leadgenId: item.leadgenId,
          formId,
          fbLead: { name: item.name, phone: item.phone, email: item.email, raw: item.raw },
          startedAt,
          retryPayload: { leadgen_id: item.leadgenId, page_id: source.pageId, form_id: formId },
        });
        await db.insert(leadImportLogs).values({
          importId,
          leadgenId: item.leadgenId,
          formId,
          status: result.outcome === "duplicate" ? "duplicate" : "imported",
          leadId: result.leadId,
        });
        await db
          .update(leadImports)
          .set(
            result.outcome === "duplicate"
              ? { totalSkipped: sql`${leadImports.totalSkipped} + 1`, lastProcessedAt: new Date() }
              : { totalImported: sql`${leadImports.totalImported} + 1`, lastProcessedAt: new Date() }
          )
          .where(eq(leadImports.id, importId));
      } catch (err) {
        // One bad lead never aborts the run — logged, counted, and the
        // loop moves on to the next lead in this same page.
        const message = err instanceof Error ? err.message : "Unknown error";
        logger.error("import_lead_failed", { importId, formId, leadgenId: item.leadgenId, error: message });
        await db.insert(leadImportLogs).values({ importId, leadgenId: item.leadgenId, formId, status: "failed", error: message });
        await db
          .update(leadImports)
          .set({ totalFailed: sql`${leadImports.totalFailed} + 1`, lastProcessedAt: new Date() })
          .where(eq(leadImports.id, importId));
      }

      // A cancel request should take effect within a lead or two, not only
      // at the end of a 100-lead page — re-checked here, not just at the
      // top of the outer loop.
      const [liveJob] = await db.select({ cancelRequested: leadImports.cancelRequested }).from(leadImports).where(eq(leadImports.id, importId)).limit(1);
      if (liveJob?.cancelRequested) {
        await db.update(leadImports).set({ status: "cancelled", completedAt: new Date(), lastProcessedAt: new Date() }).where(eq(leadImports.id, importId));
        return;
      }
    }

    const isLastPageOfForm = !page.nextCursor;
    const nextCheckpoint: Checkpoint = isLastPageOfForm
      ? { formIndex: checkpoint.formIndex + 1, afterCursor: null }
      : { formIndex: checkpoint.formIndex, afterCursor: page.nextCursor };

    await db
      .update(leadImports)
      .set({ checkpoint: nextCheckpoint, lastProcessedAt: new Date() })
      .where(eq(leadImports.id, importId));

    pagesThisInvocation++;
    await sleep(THROTTLE_MS);
  }
  // Hit this invocation's page/duration ceiling on a very large import —
  // yield back with the checkpoint already persisted. The next
  // poll-triggered kick or cron sweep continues exactly where this left
  // off, the same as it would after a restart.
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Cron-triggered (see /api/cron/resume-imports): finds any import whose
// in-process loop has gone quiet — status=running but no heartbeat in
// HEARTBEAT_STALE_MINUTES, which happens after a Render restart/deploy
// killed the loop mid-run — and resumes it from its persisted checkpoint.
export async function resumeStaleImports(): Promise<number> {
  const staleCutoff = new Date(Date.now() - HEARTBEAT_STALE_MINUTES * 60_000);
  const stale = await db
    .select({ id: leadImports.id })
    .from(leadImports)
    .where(and(eq(leadImports.status, "running"), lt(leadImports.lastProcessedAt, staleCutoff)));
  for (const row of stale) {
    kickImport(row.id);
  }
  return stale.length;
}

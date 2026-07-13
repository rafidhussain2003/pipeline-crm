import { NextResponse } from "next/server";
import { db } from "@/db";
import { leadSources, leadImports } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { and, eq, desc } from "drizzle-orm";
import { kickImport } from "@/lib/lead-sources/import-engine";

// Polled by the connector page while an import is visible — this is one of
// the two things that keep an import moving (the other is the cron sweep,
// for when nobody's watching). Returns the most recent import for this
// source, running or not, so the UI can show a finished run's final
// counters without a separate "did it finish" round trip.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const [source] = await db
    .select({ id: leadSources.id })
    .from(leadSources)
    .where(and(eq(leadSources.id, id), eq(leadSources.companyId, session.companyId)))
    .limit(1);
  if (!source) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [job] = await db
    .select()
    .from(leadImports)
    .where(eq(leadImports.sourceId, id))
    .orderBy(desc(leadImports.startedAt))
    .limit(1);

  if (!job) return NextResponse.json({ import: null });

  if (job.status === "running") kickImport(job.id);

  const formIds = job.formIds as string[];
  const checkpoint = job.checkpoint as { formIndex: number; afterCursor: string | null };
  const formsCompleted = Math.min(checkpoint.formIndex, formIds.length);
  const elapsedMs = Date.now() - new Date(job.startedAt).getTime();

  // Meta's leads endpoint has no upfront total count (cursor pagination
  // only) — "estimated time remaining" is necessarily a rough estimate
  // extrapolated from forms actually finished so far, not a precise
  // countdown. Null (shown as "Calculating…") until at least one form has
  // completed, rather than guessing from zero data.
  let estimatedSecondsRemaining: number | null = null;
  if (job.status === "running" && formsCompleted > 0 && formsCompleted < formIds.length) {
    const avgMsPerForm = elapsedMs / formsCompleted;
    estimatedSecondsRemaining = Math.round((avgMsPerForm * (formIds.length - formsCompleted)) / 1000);
  }

  return NextResponse.json({
    import: {
      id: job.id,
      status: job.status,
      range: job.range,
      totalFound: job.totalFound,
      totalImported: job.totalImported,
      totalSkipped: job.totalSkipped,
      totalFailed: job.totalFailed,
      currentFormName: job.currentFormName,
      formsTotal: formIds.length,
      formsCompleted,
      estimatedSecondsRemaining,
      error: job.error,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    },
  });
}

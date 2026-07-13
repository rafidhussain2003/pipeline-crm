import { NextResponse } from "next/server";
import { db } from "@/db";
import { leadSources, leadImports } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { and, eq, desc } from "drizzle-orm";

// Every import ever run for this Page, most recent first — Start Time, End
// Time, Duration, Total Found, Imported, Skipped, Duplicates (counted the
// same as Skipped here — see leadImports.totalSkipped), Failed,
// Cancelled/Completed status.
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

  const rows = await db
    .select({
      id: leadImports.id,
      status: leadImports.status,
      range: leadImports.range,
      totalFound: leadImports.totalFound,
      totalImported: leadImports.totalImported,
      totalSkipped: leadImports.totalSkipped,
      totalFailed: leadImports.totalFailed,
      error: leadImports.error,
      startedAt: leadImports.startedAt,
      completedAt: leadImports.completedAt,
    })
    .from(leadImports)
    .where(eq(leadImports.sourceId, id))
    .orderBy(desc(leadImports.startedAt))
    .limit(50);

  return NextResponse.json({ imports: rows });
}

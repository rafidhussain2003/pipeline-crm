import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leadSources, leadImports } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { and, eq } from "drizzle-orm";

// Sets cancelRequested — the running loop (wherever it's currently
// executing, in this process or resumed by the cron sweep in another one)
// checks this every iteration and stops gracefully after its current page,
// rather than being killed mid-write. Leads already imported stay; only
// the remaining queue stops.
//
// `importId` comes in the request body rather than the path on purpose:
// this keeps `cancel` a STATIC sibling of `current`/`history` under
// `import/`. A dynamic `[importId]` segment sitting beside those static
// siblings triggers a Next.js App Router matching edge case where the
// dynamic branch fails to resolve (returns 404) — see this app's other
// double-dynamic route `[id]/forms/[formId]`, which works precisely
// because it has no static siblings at that level.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId || session.role !== "admin") {
    return NextResponse.json({ error: "Only company admins can cancel an import" }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const importId = body.importId as string | undefined;
  if (!importId) return NextResponse.json({ error: "importId is required" }, { status: 400 });

  const [source] = await db
    .select({ id: leadSources.id })
    .from(leadSources)
    .where(and(eq(leadSources.id, id), eq(leadSources.companyId, session.companyId)))
    .limit(1);
  if (!source) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [job] = await db
    .select({ id: leadImports.id, status: leadImports.status })
    .from(leadImports)
    .where(and(eq(leadImports.id, importId), eq(leadImports.sourceId, id)))
    .limit(1);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (job.status !== "running") return NextResponse.json({ error: "This import is not running" }, { status: 400 });

  await db.update(leadImports).set({ cancelRequested: true }).where(eq(leadImports.id, importId));
  return NextResponse.json({ ok: true });
}

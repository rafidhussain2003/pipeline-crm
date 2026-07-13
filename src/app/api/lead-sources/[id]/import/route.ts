import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leadSources, leadForms, leadImports } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { and, eq, isNull } from "drizzle-orm";
import { startImport, type ImportRange } from "@/lib/lead-sources/import-engine";

const VALID_RANGES: ImportRange[] = ["7d", "30d", "90d", "180d", "365d", "all"];

// Starts a historical import for one connected Page, covering every
// currently-enabled Lead Form on it — the same set of forms already
// sending it live leads, so "import history" and "receive going forward"
// always mean the same forms.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId || session.role !== "admin") {
    return NextResponse.json({ error: "Only company admins can import historical leads" }, { status: 403 });
  }
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const range = body.range as string;
  if (!VALID_RANGES.includes(range as ImportRange)) {
    return NextResponse.json({ error: `range must be one of ${VALID_RANGES.join(", ")}` }, { status: 400 });
  }

  const [source] = await db
    .select()
    .from(leadSources)
    .where(and(eq(leadSources.id, id), eq(leadSources.companyId, session.companyId), isNull(leadSources.deletedAt)))
    .limit(1);
  if (!source) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (source.platform !== "facebook") {
    return NextResponse.json({ error: "Historical import is only available for Meta Lead Ads sources" }, { status: 400 });
  }
  if (!source.accessToken) {
    return NextResponse.json({ error: "This source has no access token — reconnect it first" }, { status: 400 });
  }

  // Only one active import per source at a time — starting a second would
  // just race the first over the same forms/checkpoints.
  const [existingRunning] = await db
    .select({ id: leadImports.id })
    .from(leadImports)
    .where(and(eq(leadImports.sourceId, id), eq(leadImports.status, "running")))
    .limit(1);
  if (existingRunning) {
    return NextResponse.json({ error: "An import is already running for this Page", importId: existingRunning.id }, { status: 409 });
  }

  const enabledForms = await db
    .select({ formId: leadForms.formId })
    .from(leadForms)
    .where(and(eq(leadForms.sourceId, id), eq(leadForms.enabled, true)));
  if (enabledForms.length === 0) {
    return NextResponse.json({ error: "No enabled Lead Forms on this Page to import from" }, { status: 400 });
  }

  const job = await startImport({
    companyId: session.companyId,
    sourceId: id,
    range: range as ImportRange,
    formIds: enabledForms.map((f) => f.formId),
    createdBy: session.userId,
  });

  return NextResponse.json({ import: job });
}

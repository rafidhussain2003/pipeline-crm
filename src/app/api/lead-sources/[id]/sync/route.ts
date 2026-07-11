import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leadSources } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { and, eq, isNull } from "drizzle-orm";
import { checkPolicy } from "@/lib/rate-limit";
import { syncOneSource } from "@/lib/lead-sources/actions";

// "Sync Now" for one Page. See lib/lead-sources/actions.ts for what this
// actually does — shared with the account-level bulk sync endpoint so
// there's exactly one implementation of "sync a page," not two.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId || session.role !== "admin") {
    return NextResponse.json({ error: "Only company admins can sync a source" }, { status: 403 });
  }
  const { id } = await params;

  const rl = checkPolicy("oauth.facebook", session.userId);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
  }

  const [source] = await db
    .select()
    .from(leadSources)
    .where(and(eq(leadSources.id, id), eq(leadSources.companyId, session.companyId), isNull(leadSources.deletedAt)))
    .limit(1);
  if (!source) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result = await syncOneSource(source, { userId: session.userId, companyId: session.companyId });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json(result);
}

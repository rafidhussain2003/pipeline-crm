import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { tags } from "@/db/schema";
import { requireCompanySession } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { withRoute, timed } from "@/lib/api-handler";

export async function GET(req: NextRequest) {
  return withRoute("tags", "GET", req, async (logger) => {
    const auth = await requireCompanySession();
    if (!auth.ok) return auth.response;
    logger.setContext({ userId: auth.session.userId, companyId: auth.session.companyId });

    const rows = await timed(logger, "select_tags", () =>
      db.select().from(tags).where(eq(tags.companyId, auth.session.companyId))
    );
    logger.info("tags_listed", { count: rows.length });
    return NextResponse.json({ tags: rows });
  });
}

export async function POST(req: NextRequest) {
  return withRoute("tags", "POST", req, async (logger) => {
    const auth = await requirePermission("tags:manage");
    if (!auth.ok) return auth.response;
    logger.setContext({ userId: auth.session.userId, companyId: auth.session.companyId });

    const { label, color } = await req.json();
    if (!label) return NextResponse.json({ error: "Label is required" }, { status: 400 });

    const [tag] = await timed(logger, "insert_tag", () =>
      db.insert(tags).values({ companyId: auth.session.companyId, label, color: color || "#64748b" }).returning()
    );
    logger.info("tag_created", { tagId: tag.id });
    return NextResponse.json({ tag });
  });
}

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { tags } from "@/db/schema";
import { requireCompanySession } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { withRoute, timed } from "@/lib/api-handler";
import { isUniqueViolation } from "@/lib/db-errors";

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
    const trimmed = typeof label === "string" ? label.trim() : "";
    if (!trimmed) return NextResponse.json({ error: "Label is required" }, { status: 400 });

    // The (company_id, label) unique index is what actually prevents duplicate
    // tags — a pre-insert lookup would be a check-then-insert two concurrent
    // creates could both pass. Translate the constraint violation into a 409
    // instead of letting it surface as a 500.
    let tag;
    try {
      [tag] = await timed(logger, "insert_tag", () =>
        db.insert(tags).values({ companyId: auth.session.companyId, label: trimmed, color: color || "#64748b" }).returning()
      );
    } catch (err) {
      if (isUniqueViolation(err, "tags_company_label_uniq")) {
        logger.info("tag_duplicate_rejected", { label: trimmed });
        return NextResponse.json({ error: `A tag named "${trimmed}" already exists` }, { status: 409 });
      }
      throw err;
    }
    logger.info("tag_created", { tagId: tag.id });
    return NextResponse.json({ tag });
  });
}

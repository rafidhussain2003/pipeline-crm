import { NextRequest, NextResponse } from "next/server";
import { requireCompanySession } from "@/lib/auth";
import { withRoute, timed } from "@/lib/api-handler";
import { checkPolicy } from "@/lib/rate-limit";
import { cache } from "@/lib/infra/cache";
import { resolveDateRange, parseDateRangeKey } from "@/lib/analytics/range";
import type { DateRange } from "@/lib/analytics/types";
import { generateInsights } from "@/lib/ai/insights";

export async function GET(req: NextRequest) {
  return withRoute("analytics.insights", "GET", req, async (logger) => {
    const auth = await requireCompanySession();
    if (!auth.ok) return auth.response;
    logger.setContext({ userId: auth.session.userId, companyId: auth.session.companyId });

    const rl = checkPolicy("api.authenticated", auth.session.userId);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
    }

    const { searchParams } = new URL(req.url);
    const rangeKey = parseDateRangeKey(searchParams.get("range"));

    let range: DateRange;
    try {
      range = resolveDateRange(rangeKey, searchParams.get("from"), searchParams.get("to"));
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid date range" }, { status: 400 });
    }

    const cacheKey = `ai:insights:${auth.session.companyId}:${rangeKey}:${range.from.toISOString()}:${range.to.toISOString()}`;
    const insights = await cache.getOrSet(cacheKey, 60_000, () =>
      timed(logger, "generate_insights", () => generateInsights(auth.session.companyId, range))
    );

    logger.info("insights_generated", { range: rangeKey, count: insights.length });
    return NextResponse.json({ range, insights });
  });
}

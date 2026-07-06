import { NextRequest, NextResponse } from "next/server";
import { requireCompanySession } from "@/lib/auth";
import { withRoute, timed } from "@/lib/api-handler";
import { checkPolicy } from "@/lib/rate-limit";
import { cache } from "@/lib/infra/cache";
import { resolveDateRange, parseDateRangeKey } from "@/lib/analytics/range";
import type { DateRange } from "@/lib/analytics/types";
import { getLeadSummary, getLeadsGroupedBy, type GroupByField } from "@/lib/analytics/service";

const VALID_GROUP_BY: GroupByField[] = ["disposition", "source", "agent"];

// One reusable widget endpoint covering "today's leads / yesterday / this
// week / this month / custom range" and "leads by source/disposition/agent"
// — a single parameterized route + shared service function, rather than 4
// nearly-identical route files. Each call is still an independent request
// (a dashboard widget calling this with groupBy=source doesn't depend on
// or block one calling with groupBy=disposition).
export async function GET(req: NextRequest) {
  return withRoute("analytics.leads", "GET", req, async (logger) => {
    const auth = await requireCompanySession();
    if (!auth.ok) return auth.response;
    logger.setContext({ userId: auth.session.userId, companyId: auth.session.companyId });

    const rl = checkPolicy("api.authenticated", auth.session.userId);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
    }

    const { searchParams } = new URL(req.url);
    const rangeKey = parseDateRangeKey(searchParams.get("range"));
    const groupByParam = searchParams.get("groupBy");

    let range: DateRange;
    try {
      range = resolveDateRange(rangeKey, searchParams.get("from"), searchParams.get("to"));
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid date range" }, { status: 400 });
    }

    const cacheKey = `analytics:leads:${auth.session.companyId}:${rangeKey}:${range.from.toISOString()}:${range.to.toISOString()}:${groupByParam || "summary"}`;

    if (groupByParam) {
      if (!VALID_GROUP_BY.includes(groupByParam as GroupByField)) {
        return NextResponse.json({ error: `groupBy must be one of: ${VALID_GROUP_BY.join(", ")}` }, { status: 400 });
      }
      const groups = await cache.getOrSet(cacheKey, 60_000, () =>
        timed(logger, `leads_by_${groupByParam}`, () => getLeadsGroupedBy(auth.session.companyId, range, groupByParam as GroupByField))
      );
      logger.info("analytics_leads_grouped", { groupBy: groupByParam, range: rangeKey, groupCount: groups.length });
      return NextResponse.json({ groupBy: groupByParam, range, groups });
    }

    const summary = await cache.getOrSet(cacheKey, 60_000, () => timed(logger, "leads_summary", () => getLeadSummary(auth.session.companyId, range)));
    logger.info("analytics_leads_summary", { range: rangeKey, total: summary.total });
    return NextResponse.json(summary);
  });
}

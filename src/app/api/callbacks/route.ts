import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { CallbackError, callbackCounts, listCallbacks, listCallbacksForLead, scheduleCallback, type CallbackTab } from "@/lib/callbacks";

const TABS = ["today", "upcoming", "overdue", "completed"];

// Callback dashboard feed. Scope (agent sees own / manager+admin see all) is
// decided in the service from the session — never from a client parameter.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const p = req.nextUrl.searchParams;

  // ?leadId= — the callbacks shown inline on a Lead Details page.
  const leadId = p.get("leadId");
  if (leadId) return NextResponse.json({ items: await listCallbacksForLead(session, leadId) });

  const rawTab = p.get("tab") ?? "today";
  const tab = (TABS.includes(rawTab) ? rawTab : "today") as CallbackTab;
  const agentId = p.get("agentId") || undefined;

  const [items, counts] = await Promise.all([
    listCallbacks(session, {
      tab,
      search: p.get("search") || undefined,
      agentId,
      priority: p.get("priority") || undefined,
      reason: p.get("reason") || undefined,
      limit: Number(p.get("limit")) || 50,
      offset: Number(p.get("offset")) || 0,
    }),
    callbackCounts(session, agentId),
  ]);
  return NextResponse.json({ items, counts, tab });
}

// Schedule a callback. Returns as soon as the rows are written — the reminder
// worker is kicked fire-and-forget and is never awaited here.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (!body?.leadId || typeof body.leadId !== "string") return NextResponse.json({ error: "leadId is required" }, { status: 400 });
  if (!body?.scheduledAt || typeof body.scheduledAt !== "string") return NextResponse.json({ error: "scheduledAt is required" }, { status: 400 });

  try {
    const callback = await scheduleCallback(session, {
      leadId: body.leadId,
      scheduledAt: new Date(body.scheduledAt),
      timezone: typeof body.timezone === "string" ? body.timezone : undefined,
      reason: typeof body.reason === "string" ? body.reason : "",
      notes: typeof body.notes === "string" ? body.notes : null,
      priority: typeof body.priority === "string" ? body.priority : undefined,
      agentId: typeof body.agentId === "string" ? body.agentId : undefined,
    });
    return NextResponse.json({ callback }, { status: 201 });
  } catch (err) {
    if (err instanceof CallbackError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

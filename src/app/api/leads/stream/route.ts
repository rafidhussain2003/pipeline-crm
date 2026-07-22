import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leads, leadSources } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { and, eq, gt, isNull, count } from "drizzle-orm";
import { leadStreamHub, ensureLeadStreamListener } from "@/lib/leads/stream-hub";

// Phase 1B — live "new lead arrived" signal for the CRM (Server-Sent Events).
//
// The stream carries a SIGNAL, not lead data: an id and a timestamp, nothing
// more. The table is still filled by the existing paginated /api/leads call, so
// a company with 6k leads pushes a few dozen bytes per arrival instead of rows,
// and the browser never holds anything it did not ask for.
//
// Company-scoped, every authenticated role — an agent needs to see arrivals as
// much as an admin. Scope comes from the session, never from a query param, so
// a tab can only ever receive its own company's leads.
export const dynamic = "force-dynamic";

// Below Render's/most proxies' 60s idle timeout, so an idle stream is not
// silently reaped and forced through a reconnect it did not need.
const HEARTBEAT_MS = 25_000;

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const companyId = session.companyId;

  ensureLeadStreamListener();

  // Reconnect replay. The client sends the timestamp of the last arrival it
  // knows about; anything created since is counted from the database, so a
  // dropped connection cannot silently swallow arrivals (Task 6). Authoritative
  // by construction — no in-memory buffer to go stale or be lost on restart.
  const sinceParam = req.nextUrl.searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : null;
  const sinceValid = since && !Number.isNaN(since.getTime());

  const encoder = new TextEncoder();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* stream already torn down */
        }
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // Tell the client it is live before anything else, so the connection
      // indicator settles immediately rather than after the first arrival.
      send("ready", { at: new Date().toISOString() });

      // Agent Portal: an agent's stream carries no company-wide information.
      // New-arrival counts describe unassigned leads an agent can't see, so
      // both the live "lead.created" frames and the reconnect "missed" replay
      // are admin/manager-only. Assignment signals ARE forwarded to agents —
      // an assignment may add or remove one of THEIR leads — but stripped to
      // a bare timestamp: no lead ids, no other agents' ids, nothing to
      // correlate. The client just re-runs its own (owner-scoped) query.
      const isAgent = session.role === "agent";

      if (sinceValid && !isAgent) {
        try {
          const [{ missed }] = await db
            .select({ missed: count() })
            .from(leads)
            .where(and(eq(leads.companyId, companyId), isNull(leads.deletedAt), gt(leads.createdAt, since!)));
          if (missed > 0) send("missed", { count: missed, since: since!.toISOString() });
        } catch {
          // A failed replay must not kill the stream — live arrivals still
          // work, and the client reconciles on its next refresh.
        }
      }

      unsubscribe = leadStreamHub.subscribe(companyId, (signal) => {
        if (signal.type === "lead.created") {
          if (!isAgent) send("lead.created", { leadId: signal.leadId, at: signal.at, source: signal.source });
        } else if (signal.type === "lead.assigned") {
          // Ownership moved (manual assign / force-assign / auto engine) —
          // the client re-runs its current query to see the change.
          if (isAgent) send("lead.assigned", { at: signal.at });
          else send("lead.assigned", { leadId: signal.leadId, agentId: signal.agentId, at: signal.at });
          // New-lead alert: ONLY the connection belonging to the NEW OWNER
          // gets an enriched event (name/phone/source drive the floating
          // notification + sound). The privacy discipline above is intact —
          // this is the owner's own lead, delivered to nobody else — and
          // self-assignments don't alert. Enrichment is a single indexed
          // lookup, async so the callback (and the plain signal above) never
          // waits on it; if it fails the alert still fires with what the
          // signal carries.
          if (signal.agentId === session.userId && signal.actorUserId !== session.userId) {
            void (async () => {
              let name: string | null = null;
              let phone: string | null = null;
              let source: string | null = null;
              try {
                const [row] = await db
                  .select({
                    name: leads.name,
                    phone: leads.phone,
                    // Same privacy layer as every agent-facing source read:
                    // the agent alias when set, the real page name otherwise
                    // (pageName alone is admin-only — campaign names leak
                    // strategy; see the leadSources schema comment).
                    sourceAlias: leadSources.agentDisplayName,
                    sourceName: leadSources.pageName,
                  })
                  .from(leads)
                  .leftJoin(leadSources, eq(leads.sourceId, leadSources.id))
                  .where(and(eq(leads.id, signal.leadId), eq(leads.companyId, companyId)))
                  .limit(1);
                if (row) {
                  name = row.name;
                  phone = row.phone;
                  source = row.sourceAlias || row.sourceName;
                }
              } catch {
                /* alert still fires below with ids only */
              }
              send("lead.assigned.me", { leadId: signal.leadId, name, phone, source, at: signal.at });
            })();
          }
        } else if (signal.type === "team.updated") {
          // Roster change (agent tier). Admin/manager screens only — the
          // Agent Portal never exposes roster data to agents.
          if (!isAgent) send("team.updated", { userId: signal.userId, at: signal.at });
        } else if (signal.type === "lead.updated") {
          // In-place change (note / callback / disposition) — the Lead
          // Workspace re-fetches what it's showing. Agents get a bare
          // timestamp (their page's refetch is owner-scoped server-side
          // anyway, and no lead ids from other agents' work should reach
          // them); admins/managers get the leadId so only the open lead's
          // page bothers to refetch.
          if (isAgent) send("lead.updated", { at: signal.at });
          else send("lead.updated", { leadId: signal.leadId, at: signal.at });
        }
      });

      heartbeat = setInterval(() => {
        if (closed) return;
        // A comment line keeps the socket warm without being delivered as an
        // event to the client.
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          cleanup();
        }
      }, HEARTBEAT_MS);

      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Proxies that buffer would defeat the point of a stream.
      "X-Accel-Buffering": "no",
    },
  });
}

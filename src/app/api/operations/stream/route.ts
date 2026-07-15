import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getOperationsSnapshot, ensureActivityListeners, activityHub } from "@/lib/operations";

// Live Operations Center stream (Server-Sent Events). The client opens ONE
// EventSource and never polls:
//   • "snapshot"      — the aggregate cards/agents/warnings, pushed on connect
//                       and refreshed on a cached 5s tick (server push, not a
//                       client poll; the snapshot is cached so N watchers of a
//                       company cost one recompute per 5s).
//   • "activity"      — a single live event, pushed the instant it fires on the
//                       in-process event bus (truly event-driven, in-memory).
// This is the WebSockets/SSE-ready transport; a Redis pub/sub fan-out slots in
// behind activityHub later for multi-instance without changing this route.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.companyId || (session.role !== "admin" && session.role !== "manager")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const companyId = session.companyId;
  ensureActivityListeners();

  const encoder = new TextEncoder();
  let closed = false;

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

      // Initial state: current snapshot + the recent activity buffer.
      try {
        send("snapshot", await getOperationsSnapshot(companyId));
      } catch {
        /* transient DB blip — the tick will retry */
      }
      send("activity_batch", activityHub.getRecent(companyId, 50));

      // Live activity — pushed the moment a bus event fires.
      const unsubscribe = activityHub.subscribe(companyId, (item) => send("activity", item));

      // Aggregate refresh (cached) + keepalive.
      const tick = setInterval(async () => {
        try {
          send("snapshot", await getOperationsSnapshot(companyId));
        } catch {
          /* ignore, keep the stream open */
        }
      }, 5_000);
      const ping = setInterval(() => {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(`: ping\n\n`));
          } catch {
            /* ignore */
          }
        }
      }, 25_000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(tick);
        clearInterval(ping);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // don't let a proxy buffer the stream
    },
  });
}

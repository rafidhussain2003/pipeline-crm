import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { callbackHub, getDueForUser, labelForKind, type CallbackReminderPayload } from "@/lib/callbacks";

// Live callback reminders (Server-Sent Events). The client opens ONE
// EventSource per session and NEVER polls — the reminder worker publishes to
// the hub and the reminder lands in the agent's browser the instant it fires.
//
//   "due_batch" — reminders that fired while the agent was away/offline,
//                 replayed on connect so nothing is silently missed.
//   "reminder"  — a single reminder, pushed live.
//
// The stream is keyed to session.userId, so an agent can only ever receive
// their own reminders — there is no company-wide fan-out to filter client-side.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.userId;

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

      // Replay anything still unacknowledged (survives reload / offline agent).
      try {
        const due = await getDueForUser(session);
        send(
          "due_batch",
          due.map((d): CallbackReminderPayload => ({
            callbackId: d.callbackId,
            leadId: d.leadId,
            leadName: d.leadName ?? null,
            kind: d.status === "missed" ? "overdue" : "at_time",
            label: d.status === "missed" ? "Callback overdue" : labelForKind("at_time"),
            scheduledAt: d.scheduledAt.toISOString(),
            reason: d.reason,
            priority: d.priority as CallbackReminderPayload["priority"],
            priorityScore: d.priorityScore ?? 0,
            status: d.status,
            at: new Date().toISOString(),
          })),
        );
      } catch {
        /* transient DB blip — live pushes still work */
      }

      const unsubscribe = callbackHub.subscribe(userId, (p) => send("reminder", p));

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
      "X-Accel-Buffering": "no",
    },
  });
}

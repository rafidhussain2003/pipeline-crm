// Shared client for /api/leads/stream — ONE EventSource per browser tab,
// however many components are listening.
//
// Before this, every realtime consumer (leads list, lead workspace, My
// Tasks, the new-lead alert) opened its OWN EventSource to the same
// endpoint, each with a copy-pasted reconnect/backoff loop. A typical tab
// held two identical streams — two server-side hub subscriptions, two
// 25s heartbeat timers, two Render connections — delivering the same
// frames twice. This module owns a single ref-counted connection that all
// of them subscribe to; because the new-lead alert is mounted in the app
// layout (which persists across client navigations), the connection also
// stays warm while the user moves between pages instead of tearing down
// and re-handshaking on every navigation.
//
// Semantics preserved from the per-page implementations it replaces:
//   • `?since=` watermark: advanced from every frame carrying `at`, reset
//     to "now" on a missed-replay frame, so a manual reconnect never
//     re-reports the same missed leads (EventSource's built-in retry always
//     reuses the ORIGINAL url — that's why reconnect is manual).
//   • Capped exponential backoff: 1s · 2^n up to 30s, reset on "ready".
//   • Last unsubscribe closes the connection.

type EventHandler = (rawData: string) => void;

export type LeadStreamSubscription = {
  // Handlers by SSE event name (e.g. "lead.assigned", "lead.created",
  // "missed", "lead.assigned.me"). Payload is the raw `data:` string —
  // consumers keep their own JSON.parse + error discipline.
  events: Record<string, EventHandler>;
  // Fired with true on every successful ("ready") connect, false when the
  // connection drops. Fired immediately with the current state on subscribe.
  onConnectionChange?: (connected: boolean) => void;
};

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 30_000;

const subscribers = new Set<LeadStreamSubscription>();
// One dispatcher per event NAME attached to the live EventSource; kept so a
// reconnect can re-attach and a late subscriber with a brand-new event name
// can attach to the already-open connection.
const attached = new Map<string, (e: MessageEvent) => void>();

let es: EventSource | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let attempt = 0;
let connected = false;
let watermark = "";

function dispatcherFor(name: string): (e: MessageEvent) => void {
  return (e: MessageEvent) => {
    // Central watermark bookkeeping (see module comment).
    if (name === "missed") {
      watermark = new Date().toISOString();
    } else {
      try {
        const at = (JSON.parse(e.data) as { at?: string }).at;
        if (at) watermark = at;
      } catch {
        /* payload-less frame */
      }
    }
    for (const sub of subscribers) {
      const handler = sub.events[name];
      if (!handler) continue;
      try {
        handler(e.data);
      } catch {
        // One consumer throwing must not starve the others — same fan-out
        // discipline as the server-side hub.
      }
    }
  };
}

function attachName(name: string) {
  if (!es || attached.has(name)) return;
  const dispatcher = dispatcherFor(name);
  attached.set(name, dispatcher);
  es.addEventListener(name, dispatcher);
}

function notifyConnection(state: boolean) {
  if (connected === state) return;
  connected = state;
  for (const sub of subscribers) {
    try {
      sub.onConnectionChange?.(state);
    } catch {
      /* ignore */
    }
  }
}

function connect() {
  if (es || subscribers.size === 0) return;
  const url = `/api/leads/stream?since=${encodeURIComponent(watermark)}`;
  es = new EventSource(url);
  attached.clear();

  es.addEventListener("ready", () => {
    attempt = 0;
    notifyConnection(true);
  });
  for (const sub of subscribers) for (const name of Object.keys(sub.events)) attachName(name);

  es.onerror = () => {
    es?.close();
    es = null;
    attached.clear();
    notifyConnection(false);
    if (subscribers.size === 0) return;
    attempt += 1;
    retryTimer = setTimeout(connect, Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_CAP_MS));
  };
}

function teardown() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  es?.close();
  es = null;
  attached.clear();
  attempt = 0;
  notifyConnection(false);
}

/**
 * Subscribe to the shared leads stream. Opens the connection on the first
 * subscriber, closes it when the last one leaves. Returns an unsubscribe
 * function (idempotent — React StrictMode double-invokes effect cleanups).
 */
export function subscribeLeadStream(sub: LeadStreamSubscription): () => void {
  if (subscribers.size === 0) {
    // First subscriber of this connection's lifetime: only arrivals from now
    // on matter (same "watermark starts at mount" rule the leads page used).
    watermark = new Date().toISOString();
  }
  subscribers.add(sub);
  if (es) {
    for (const name of Object.keys(sub.events)) attachName(name);
  } else {
    connect();
  }
  try {
    sub.onConnectionChange?.(connected);
  } catch {
    /* ignore */
  }

  let done = false;
  return () => {
    if (done) return;
    done = true;
    subscribers.delete(sub);
    if (subscribers.size === 0) teardown();
  };
}

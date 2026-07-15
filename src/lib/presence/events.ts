// Presence lifecycle event emission. Called ONLY by the service, ONLY on an
// actual state transition (prev !== next). Emitting an event never throws
// into the caller — the event bus isolates listener failures — so a presence
// write can never be turned into a failure by a downstream listener.
import { eventBus } from "@/lib/events/bus";
import { isEligibleState, type PresenceState } from "./state";

export async function emitPresenceTransition(
  userId: string,
  companyId: string | null,
  prev: PresenceState,
  next: PresenceState
): Promise<void> {
  const payload = { userId, companyId };

  switch (next) {
    case "ONLINE":
      await eventBus.emit("presence.online", payload);
      break;
    case "BUSY":
      await eventBus.emit("presence.busy", payload);
      break;
    case "AWAY":
      await eventBus.emit("presence.away", payload);
      break;
    case "LOCKED":
      await eventBus.emit("presence.locked", payload);
      break;
    case "OFFLINE":
      await eventBus.emit("presence.offline", payload);
      break;
    case "LOGGED_OUT":
      await eventBus.emit("presence.logged_out", payload);
      break;
    case "UNKNOWN":
      break; // no dedicated event for the "can't tell" state
  }

  // Crossing the eligibility boundary is the heartbeat lost / restored signal
  // that monitoring and future consumers care about most.
  const wasEligible = isEligibleState(prev);
  const isEligible = isEligibleState(next);
  if (wasEligible && !isEligible) await eventBus.emit("presence.heartbeat_lost", payload);
  else if (!wasEligible && isEligible) await eventBus.emit("presence.heartbeat_restored", payload);
}

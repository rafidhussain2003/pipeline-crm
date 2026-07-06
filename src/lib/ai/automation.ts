// AI automation (Part 9) — "AI should recommend first, human approval
// remains supported": this listener NEVER reassigns, changes disposition,
// or takes any action on its own. It only sends a notification (the same
// in-app channel already built in Phase 5) suggesting what a human should
// do next, using the deterministic scoring/next-best-action logic above.
// Registered as a side effect of importing this file — imported from
// src/lib/assignment.ts, the same place the Phase 5 notification listener
// is imported from, since both react to the same "lead.assigned" event.
import { eventBus } from "../events/bus";
import { scoreLead } from "./lead-scoring";
import { recommendNextAction } from "./next-best-action";
import { sendNotification } from "../notifications/service";
import { createLogger } from "../logger";

const logger = createLogger({ component: "ai-automation" });

// Only surface a notification for actions worth interrupting an agent
// for — "wait" or a routine "send_email" nudge doesn't need a proactive
// alert on top of the lead already being visible in their queue.
const NOTIFY_WORTHY_ACTIONS = new Set(["call_now", "escalate", "recycle"]);

eventBus.on("lead.assigned", async (payload) => {
  const recommendation = await recommendNextAction(payload.leadId);
  if (!recommendation || !NOTIFY_WORTHY_ACTIONS.has(recommendation.action)) {
    logger.debug("ai_automation_no_notify", { leadId: payload.leadId, action: recommendation?.action });
    return;
  }

  const score = await scoreLead(payload.leadId);

  await sendNotification({
    companyId: payload.companyId,
    userId: payload.agentId,
    type: "ai.recommendation",
    title: `AI recommendation: ${recommendation.action.replace(/_/g, " ")}`,
    body: recommendation.reasoning,
    metadata: { leadId: payload.leadId, action: recommendation.action, score: score?.score ?? null },
  });
});

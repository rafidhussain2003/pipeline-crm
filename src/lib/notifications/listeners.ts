// Registers notification listeners on the shared event bus as a
// module-load side effect — imported from src/lib/assignment.ts (the one
// place "lead.assigned" is emitted, shared by every call site: manual
// creation, CSV import, both webhooks, cron recycling, webhook retry), so
// this is guaranteed registered before that event can ever fire, the same
// pattern already used for the "lead.assign" job handler.
import { db } from "@/db";
import { leads } from "@/db/schema";
import { eq } from "drizzle-orm";
import { eventBus } from "../events/bus";
import { sendNotification } from "./service";

eventBus.on("lead.assigned", async (payload) => {
  const [lead] = await db.select({ name: leads.name }).from(leads).where(eq(leads.id, payload.leadId)).limit(1);
  await sendNotification({
    companyId: payload.companyId,
    userId: payload.agentId,
    type: "lead.assigned",
    title: `New lead assigned: ${lead?.name || "Unnamed lead"}`,
    metadata: { leadId: payload.leadId },
  });
});

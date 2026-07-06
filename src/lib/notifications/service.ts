import { db } from "@/db";
import { notifications, users } from "@/db/schema";
import { and, eq, isNull, desc } from "drizzle-orm";
import { emailProvider } from "../email/provider";
import { metrics } from "../infra/metrics";
import type { NotificationChannel, NotificationInput } from "./types";

// "in_app" is the only channel that's actually delivered by writing this
// row — the row IS the notification the user will see in-app, so it's
// recorded as "delivered" immediately. Every other channel delegates to a
// provider stub (see src/lib/email/provider.ts, src/lib/sms/provider.ts)
// and records whatever that provider actually reports — including "it
// didn't send, no provider is configured" — rather than pretending success.
export async function sendNotification(input: NotificationInput) {
  const channel: NotificationChannel = input.channel || "in_app";

  if (channel === "in_app") {
    const [row] = await db
      .insert(notifications)
      .values({
        companyId: input.companyId,
        userId: input.userId,
        channel: "in_app",
        status: "delivered",
        type: input.type,
        title: input.title,
        body: input.body,
        metadata: input.metadata || null,
      })
      .returning();
    return row;
  }

  let result: { success: boolean; reason?: string };
  if (channel === "email") {
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, input.userId)).limit(1);
    result = user
      ? await emailProvider.send({ to: user.email, subject: input.title, html: input.body || "" })
      : { success: false, reason: "User not found" };
  } else if (channel === "sms") {
    // Not implemented: users has no phone number column today, so there's
    // nowhere to send an SMS to yet, independent of the provider stub.
    result = { success: false, reason: "SMS requires a phone number, which isn't tracked on users yet" };
  } else {
    result = { success: false, reason: `Channel "${channel}" has no delivery implementation yet` };
  }

  if (!result.success) metrics.increment("notification.failed");

  const [row] = await db
    .insert(notifications)
    .values({
      companyId: input.companyId,
      userId: input.userId,
      channel,
      status: result.success ? "sent" : "failed",
      type: input.type,
      title: input.title,
      body: input.body,
      metadata: { ...(input.metadata || {}), ...(result.reason ? { failureReason: result.reason } : {}) },
    })
    .returning();

  return row;
}

export async function getNotificationsForUser(userId: string, options: { unreadOnly?: boolean; limit?: number } = {}) {
  const conditions = [eq(notifications.userId, userId)];
  if (options.unreadOnly) conditions.push(isNull(notifications.readAt));

  return db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(options.limit || 50);
}

export async function markNotificationRead(notificationId: string, userId: string) {
  const [updated] = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
    .returning();
  return updated || null;
}

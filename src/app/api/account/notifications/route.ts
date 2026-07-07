import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { eq } from "drizzle-orm";

// Profile > Notifications tab — self-service preference toggles, same
// pattern as the Account tab (no id in the URL, always "current user").
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [user] = await db
    .select({ emailNotificationsEnabled: users.emailNotificationsEnabled, smsNotificationsEnabled: users.smsNotificationsEnabled })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ preferences: user });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const allowed: Record<string, unknown> = {};
  if ("emailNotificationsEnabled" in body) {
    if (typeof body.emailNotificationsEnabled !== "boolean") {
      return NextResponse.json({ error: "emailNotificationsEnabled must be true or false." }, { status: 400 });
    }
    allowed.emailNotificationsEnabled = body.emailNotificationsEnabled;
  }
  if ("smsNotificationsEnabled" in body) {
    if (typeof body.smsNotificationsEnabled !== "boolean") {
      return NextResponse.json({ error: "smsNotificationsEnabled must be true or false." }, { status: 400 });
    }
    allowed.smsNotificationsEnabled = body.smsNotificationsEnabled;
  }
  if (Object.keys(allowed).length === 0) {
    return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  }

  const [updated] = await db
    .update(users)
    .set(allowed)
    .where(eq(users.id, session.userId))
    .returning({ emailNotificationsEnabled: users.emailNotificationsEnabled, smsNotificationsEnabled: users.smsNotificationsEnabled });

  return NextResponse.json({ preferences: updated });
}

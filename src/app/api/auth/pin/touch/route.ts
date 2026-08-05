import { NextResponse } from "next/server";
import { getSession, setPinUnlockCookie } from "@/lib/auth";
import { isPinUnlocked } from "@/lib/auth/pin";

// Slide the 1-hour unlock window forward on genuine activity. Re-issues the
// cookie ONLY when the session is currently unlocked — it can never grant an
// unlock on its own, so ~1h of real inactivity still expires it.
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isPinUnlocked(session))) return NextResponse.json({ ok: false }, { status: 401 });
  await setPinUnlockCookie(session.userId, session.sessionId);
  return NextResponse.json({ ok: true });
}

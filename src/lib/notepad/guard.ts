import { NextResponse } from "next/server";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireCompanySession } from "@/lib/auth";

// Shared request guard for the Secure Notepad routes: an active company
// session, an allowed role, and the company's notepad toggle on. Kept separate
// from server.ts (the sweep) so the in-process sweep never pulls request-only
// modules (next/headers cookies) into its import chain.
const ALLOWED_ROLES = new Set(["admin", "manager", "agent", "backend_agent"]);

export async function guardNotepad() {
  const auth = await requireCompanySession();
  if (!auth.ok) return auth;
  if (!ALLOWED_ROLES.has(auth.session.role)) {
    return { ok: false as const, response: NextResponse.json({ error: "You do not have access to the Secure Notepad." }, { status: 403 }) };
  }
  const [co] = await db
    .select({ enabled: companies.notepadEnabled })
    .from(companies)
    .where(eq(companies.id, auth.session.companyId))
    .limit(1);
  if (co && co.enabled === false) {
    return { ok: false as const, response: NextResponse.json({ error: "Secure Notepad is disabled for your company." }, { status: 403 }) };
  }
  return auth;
}

export const MAX_TABS = 40;

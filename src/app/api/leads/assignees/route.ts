import { NextResponse } from "next/server";
import { db } from "@/db";
import { users, leads, automationSettings } from "@/db/schema";
import { requirePermission } from "@/lib/permissions";
import { checkPolicy } from "@/lib/rate-limit";
import { and, asc, count, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { deriveDisplayStatus, type PresenceStatus } from "@/lib/presence";
import { TERMINAL_DISPOSITIONS } from "@/lib/assignment/constants";

// Roster for the leads-page Assign modal. Company-scoped by the session —
// there is no way to request another tenant's people — and gated by the same
// permission as the assignment itself, so the roster can't leak names to
// someone who couldn't assign anyway.
//
// Every active company member is listed (admins and managers can own leads
// just like agents — the leads table's Owner column already shows them), with
// the live-derived presence state, role, and current OPEN lead count (same
// "open workload" definition the assignment engine and Team dashboard use:
// not deleted, not in a terminal disposition).
export async function GET() {
  const auth = await requirePermission("leads:supervise");
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const rl = checkPolicy("api.authenticated", session.userId);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const members = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      presenceStatus: users.presenceStatus,
      lastHeartbeatAt: users.lastHeartbeatAt,
    })
    .from(users)
    .where(
      and(
        eq(users.companyId, session.companyId),
        eq(users.active, true),
        isNull(users.deletedAt),
        inArray(users.role, ["admin", "manager", "agent"])
      )
    )
    .orderBy(asc(users.name));

  if (members.length === 0) return NextResponse.json({ assignees: [] });

  const memberIds = members.map((m) => m.id);

  const [settingsRow] = await db
    .select({ heartbeatTimeoutSeconds: automationSettings.heartbeatTimeoutSeconds })
    .from(automationSettings)
    .where(eq(automationSettings.companyId, session.companyId))
    .limit(1);
  const heartbeatTimeoutSeconds = settingsRow?.heartbeatTimeoutSeconds ?? 90;

  const openCounts = await db
    .select({ ownerId: leads.ownerId, value: count() })
    .from(leads)
    .where(
      and(
        eq(leads.companyId, session.companyId),
        inArray(leads.ownerId, memberIds),
        isNull(leads.deletedAt),
        notInArray(leads.disposition, TERMINAL_DISPOSITIONS)
      )
    )
    .groupBy(leads.ownerId);
  const openCountMap = new Map(openCounts.map((r) => [r.ownerId, r.value]));

  const assignees = members
    .map((m) => {
      const derived = deriveDisplayStatus(
        { presenceStatus: m.presenceStatus as PresenceStatus, lastHeartbeatAt: m.lastHeartbeatAt },
        heartbeatTimeoutSeconds
      );
      return {
        id: m.id,
        name: m.name,
        role: m.role,
        // The modal shows Online/Offline; "online" is the only state that
        // means a live, active session right now (busy/away/heartbeat_lost
        // all mean "not reliably at the desk").
        online: derived === "online",
        presenceStatus: derived,
        openLeadCount: openCountMap.get(m.id) || 0,
      };
    })
    // Online agents first (the spec's sort), then alphabetically inside each
    // group — the DB query already ordered by name.
    .sort((a, b) => Number(b.online) - Number(a.online));

  return NextResponse.json({ assignees });
}

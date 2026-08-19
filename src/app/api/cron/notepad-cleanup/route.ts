import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { notepadNotes, companies } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { removeExpiredPlaceholders } from "@/lib/notepad/detect";
import { recordAudit } from "@/lib/audit";

// Secure Notepad — the weekly Friday cleanup. Permanently removes protected
// placeholders whose retention deadline has passed, keeping all normal text
// (removeExpiredPlaceholders is the single tested policy; the notepad GET
// also runs it lazily per note, so this cron is the sweep for notes nobody
// opened). Safe to schedule daily or hourly: on non-Fridays it exits
// immediately, and the per-note change detection makes re-runs no-ops.
// Authenticated by the same x-cron-secret as every other cron route.
export async function POST(req: NextRequest) {
  const providedSecret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || providedSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date();
  if (today.getDay() !== 5) {
    return NextResponse.json({ ok: true, skipped: "not Friday" });
  }

  // Only notes that can possibly contain a placeholder (cheap prefilter).
  const rows = await db
    .select({ id: notepadNotes.id, companyId: notepadNotes.companyId, content: notepadNotes.content })
    .from(notepadNotes)
    .where(sql`${notepadNotes.content} like '%protected %'`);

  let notesSwept = 0;
  let removed = 0;
  const companiesTouched = new Set<string>();
  for (const n of rows) {
    const swept = removeExpiredPlaceholders(n.content, today);
    if (swept.removed === 0) continue;
    await db
      .update(notepadNotes)
      .set({ content: swept.content, version: sql`${notepadNotes.version} + 1`, updatedAt: new Date() })
      .where(eq(notepadNotes.id, n.id));
    notesSwept++;
    removed += swept.removed;
    companiesTouched.add(n.companyId);
    // Counts only — never content.
    await recordAudit({
      companyId: n.companyId,
      userId: null,
      action: "notepad.sensitive_purged",
      entityType: "notepad_note",
      entityId: n.id,
      metadata: { removed: swept.removed, trigger: "friday_cleanup" },
    });
  }

  // Stamp every company that has the feature so the admin's settings card can
  // show the cleanup system is operational (stamped even when nothing needed
  // removing — the sweep RAN).
  await db.update(companies).set({ notepadCleanupAt: new Date() }).where(eq(companies.notepadEnabled, true));

  return NextResponse.json({ ok: true, scanned: rows.length, notesSwept, removed, companies: companiesTouched.size });
}

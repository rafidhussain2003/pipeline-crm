// Server-boot hook (Next.js instrumentation convention): runs ONCE when a
// server instance starts, before it accepts requests.
//
// Why it exists: schema changes ship as SQL files in ./drizzle, and applying
// them relied entirely on the service's start command being
// `npm run db:migrate && npm start` (render.yaml). The live service's
// dashboard settings can override that blueprint — which is exactly what
// happened when migration 0037 added disposition_options.category: the new
// code selected a column the database didn't have, /api/dispositions
// answered 500, and every disposition dropdown in the CRM went blank.
// Running pending migrations here makes the running code and the schema it
// compiled against catch up together, no matter how the process was started.
//
// Failure policy: log loudly and KEEP BOOTING. A live CRM that serves
// everything except the one unmigrated feature beats a crash loop serving
// nothing — and the affected routes carry their own fallbacks (see
// /api/dispositions).
export async function register() {
  // Node runtime only — the edge/proxy bundle must never pull in `pg`.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Never during `next build` (page-data collection has no real database —
  // local builds use placeholder env vars).
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (!process.env.DATABASE_URL) return;

  try {
    // Dynamic import keeps every Node API (pg, fs, process.cwd) out of the
    // Edge compile of this file — see lib/boot-migrations.ts.
    const { runBootMigrations } = await import("@/lib/boot-migrations");
    await runBootMigrations();
  } catch (err) {
    console.error(
      "[migrations] FAILED to apply pending migrations at boot — the app is running against a possibly stale schema:",
      err
    );
  }

  // Secure Notepad — the 12h/7d retention sweep, run IN-PROCESS on the always-on
  // web service so idle notes never keep sensitive values past their window,
  // with no external cron required. Idempotent + version-guarded, so it's safe
  // even if several instances run it or the /api/cron/notepad-cleanup endpoint
  // is also scheduled. Errors are logged and swallowed — a sweep hiccup must
  // never take the server down.
  const runNotepadSweep = async () => {
    try {
      const { sweepExpiredNotes } = await import("@/lib/notepad/server");
      await sweepExpiredNotes();
    } catch (err) {
      console.error("[notepad] retention sweep failed:", err);
    }
  };
  setTimeout(runNotepadSweep, 60_000); // once shortly after boot
  setInterval(runNotepadSweep, 60 * 60 * 1000); // then hourly

  // Sales Ledger — one-time backfill of parsed installation dates. Existing
  // sales whose free-text installation date the parser can now understand (but
  // couldn't when they were entered) get their installationAt derived and their
  // reminders created, so the daily dashboard's "Upcoming Installations" and the
  // reminder nudges light up without anyone re-typing a date. Runs ONCE shortly
  // after boot (not on an interval); bounded, keyset-paged, and idempotent.
  setTimeout(async () => {
    try {
      const { reconcileInstallationDates } = await import("@/lib/sales/reminders");
      const res = await reconcileInstallationDates();
      if (res.fixed > 0) console.log(`[sales] installation-date backfill: derived ${res.fixed} of ${res.scanned} scanned`);
    } catch (err) {
      console.error("[sales] installation-date backfill failed:", err);
    }
  }, 90_000);
}

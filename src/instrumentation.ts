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
    // Dynamic imports keep pg/drizzle out of every non-node bundle graph.
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const { db } = await import("@/db");
    const started = Date.now();
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log(`[migrations] up to date (checked in ${Date.now() - started}ms)`);
  } catch (err) {
    console.error(
      "[migrations] FAILED to apply pending migrations at boot — the app is running against a possibly stale schema:",
      err
    );
  }
}

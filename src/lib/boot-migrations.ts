// Node-only boot migration runner — dynamically imported by
// src/instrumentation.ts (which is ALSO compiled for the Edge runtime, where
// process.cwd()/fs are rejected at build time; keeping every Node API in
// this separate module is what lets the instrumentation file compile).
import path from "path";
import fs from "fs";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "@/db";

export type MigrationRunResult = { ok: boolean; detail: string };

export async function runBootMigrations(): Promise<MigrationRunResult> {
  // The migrations folder's location depends on HOW the server was started:
  // `next start` runs from the repo root (./drizzle), but the standalone
  // server (`node .next/standalone/server.js`) runs from the standalone dir
  // — where the folder only exists because next.config.ts traces it in.
  // Resolve robustly and fail with an actionable message, not a bare ENOENT.
  const candidates = [
    path.join(process.cwd(), "drizzle"),
    path.join(process.cwd(), ".next", "standalone", "drizzle"),
    path.join(process.cwd(), "..", "..", "drizzle"),
  ];
  const migrationsFolder = candidates.find((p) => fs.existsSync(path.join(p, "meta", "_journal.json")));
  if (!migrationsFolder) {
    const detail = `no migrations folder found. Searched: ${candidates.join(" | ")} (cwd=${process.cwd()})`;
    console.error(`[migrations] FAILED — ${detail}`);
    return { ok: false, detail };
  }

  const started = Date.now();
  try {
    await migrate(db, { migrationsFolder });
  } catch (err) {
    const detail = `folder=${migrationsFolder}: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[migrations] FAILED — ${detail}`);
    return { ok: false, detail };
  }
  const detail = `up to date (folder=${migrationsFolder}, checked in ${Date.now() - started}ms)`;
  console.log(`[migrations] ${detail}`);
  return { ok: true, detail };
}

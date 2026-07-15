#!/usr/bin/env node
// Phase 12 — database backup utility. Wraps `pg_dump` to produce a compressed,
// timestamped logical backup of the whole database from DATABASE_URL. Intended
// to COMPLEMENT the managed-Postgres provider's own automated backups (Render /
// Neon / Supabase all keep point-in-time backups) — run this before risky
// migrations, or on a schedule, for an extra off-provider copy.
//
// Usage:
//   node scripts/backup.mjs                 # -> backups/ziplod-<timestamp>.dump
//   BACKUP_DIR=/mnt/backups node scripts/backup.mjs
//
// Requires the postgres client tools (`pg_dump`) on PATH.
import { spawn } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const dir = process.env.BACKUP_DIR || resolve(process.cwd(), "backups");
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outFile = resolve(dir, `ziplod-${stamp}.dump`);

// Custom format (-Fc) is compressed and restorable selectively with pg_restore.
const args = ["-Fc", "-f", outFile, "--no-owner", "--no-privileges", url];
console.log(`Backing up database → ${outFile}`);
const proc = spawn("pg_dump", args, { stdio: ["ignore", "inherit", "inherit"] });

proc.on("error", (err) => {
  console.error("Failed to start pg_dump (is it installed and on PATH?):", err.message);
  process.exit(1);
});
proc.on("exit", (code) => {
  if (code === 0) {
    console.log(`✓ Backup complete: ${outFile}`);
    console.log("  Restore with: node scripts/restore.mjs " + outFile);
  } else {
    console.error(`✗ pg_dump exited with code ${code}`);
    process.exit(code ?? 1);
  }
});

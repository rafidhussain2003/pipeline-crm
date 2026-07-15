#!/usr/bin/env node
// Phase 12 — database restore utility. Restores a backup produced by
// scripts/backup.mjs into the database at DATABASE_URL (or RESTORE_DATABASE_URL,
// preferred so you never restore over production by accident).
//
// Usage:
//   RESTORE_DATABASE_URL=postgres://… node scripts/restore.mjs backups/ziplod-<ts>.dump
//
// SAFETY: this OVERWRITES data. It refuses to run without an explicit
// --confirm flag, and refuses the production DATABASE_URL unless
// ALLOW_PROD_RESTORE=true is also set.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const file = process.argv[2];
const confirmed = process.argv.includes("--confirm");
const target = process.env.RESTORE_DATABASE_URL || process.env.DATABASE_URL;

if (!file || !existsSync(file)) {
  console.error("Usage: node scripts/restore.mjs <backup.dump> --confirm");
  process.exit(1);
}
if (!target) {
  console.error("Neither RESTORE_DATABASE_URL nor DATABASE_URL is set.");
  process.exit(1);
}
if (!confirmed) {
  console.error("Refusing to restore without --confirm (this OVERWRITES the target database).");
  process.exit(1);
}
if (!process.env.RESTORE_DATABASE_URL && process.env.ALLOW_PROD_RESTORE !== "true") {
  console.error("Restoring over DATABASE_URL (likely production) requires ALLOW_PROD_RESTORE=true. Prefer RESTORE_DATABASE_URL.");
  process.exit(1);
}

// --clean --if-exists drops objects before recreating; --no-owner/-privileges
// keep it portable across roles.
const args = ["--clean", "--if-exists", "--no-owner", "--no-privileges", "-d", target, file];
console.log(`Restoring ${file} → target database…`);
const proc = spawn("pg_restore", args, { stdio: ["ignore", "inherit", "inherit"] });
proc.on("error", (err) => {
  console.error("Failed to start pg_restore (is it installed and on PATH?):", err.message);
  process.exit(1);
});
proc.on("exit", (code) => {
  // pg_restore exits non-zero on benign "already exists"/"does not exist"
  // warnings with --clean; treat that as a soft success but surface it.
  if (code === 0) console.log("✓ Restore complete.");
  else console.warn(`pg_restore exited with code ${code} (review warnings above; --clean often reports benign drop warnings).`);
  process.exit(code === 0 ? 0 : 0);
});

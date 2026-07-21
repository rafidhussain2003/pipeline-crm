// Node-only boot migration runner — dynamically imported by
// src/instrumentation.ts (which is ALSO compiled for the Edge runtime, where
// process.cwd()/fs are rejected at build time; keeping every Node API in
// this separate module is what lets the instrumentation file compile).
//
// RECONCILING migrator, not the stock drizzle one — for two proven reasons:
//   1. This database predates migration tracking (the schema was created by
//      a direct push; the Docker service never ran `drizzle-kit migrate`).
//      The stock migrator therefore replays from 0000 and dies on the first
//      "already exists" — which is exactly why migrations silently never
//      applied in production.
//   2. Migration 0035 contains CREATE INDEX CONCURRENTLY, which cannot run
//      inside the single transaction the stock migrator wraps everything in.
//
// This runner executes each pending migration STATEMENT BY STATEMENT and
// treats "object already exists" (duplicate table/index/type/enum value/
// column/schema/constraint) as "already done — skip and continue". Data
// statements in this repo's migrations are idempotent by construction
// (ON CONFLICT upserts / targeted UPDATEs), so re-running them is safe.
// Anything else fails loudly with the migration + statement named.
// Bookkeeping is drizzle-compatible (drizzle.__drizzle_migrations), so each
// migration converges once and future runs are a single SELECT.
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";

export type MigrationRunResult = { ok: boolean; detail: string };

// Postgres codes meaning "this object is already there":
//   42P07 duplicate_table (also indexes)   42710 duplicate_object (types,
//   enum values, constraints)              42701 duplicate_column
//   42P06 duplicate_schema
const ALREADY_EXISTS_CODES = new Set(["42P07", "42710", "42701", "42P06"]);

function pgCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const cause = (err as { cause?: { code?: string } }).cause;
  return cause?.code ?? (err as { code?: string }).code;
}

export async function runBootMigrations(): Promise<MigrationRunResult> {
  const candidates = [
    path.join(process.cwd(), "drizzle"),
    path.join(process.cwd(), ".next", "standalone", "drizzle"),
    path.join(process.cwd(), "..", "..", "drizzle"),
  ];
  const folder = candidates.find((p) => fs.existsSync(path.join(p, "meta", "_journal.json")));
  if (!folder) {
    const detail = `no migrations folder found. Searched: ${candidates.join(" | ")} (cwd=${process.cwd()})`;
    console.error(`[migrations] FAILED — ${detail}`);
    return { ok: false, detail };
  }

  const started = Date.now();
  try {
    const journal = JSON.parse(fs.readFileSync(path.join(folder, "meta", "_journal.json"), "utf8")) as {
      entries: { idx: number; when: number; tag: string }[];
    };
    const entries = [...journal.entries].sort((a, b) => a.idx - b.idx);

    await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS "drizzle"`));
    await db.execute(
      sql.raw(`CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`)
    );
    const appliedRes = await db.execute(sql.raw(`SELECT created_at FROM "drizzle"."__drizzle_migrations"`));
    const applied = new Set(
      (((appliedRes as unknown as { rows: { created_at: string | number }[] }).rows) ?? []).map((r) => Number(r.created_at))
    );

    const pending = entries.filter((e) => !applied.has(e.when));
    if (pending.length === 0) {
      const detail = `up to date — ${entries.length} migrations tracked (folder=${folder}, checked in ${Date.now() - started}ms)`;
      console.log(`[migrations] ${detail}`);
      return { ok: true, detail };
    }

    let skippedExisting = 0;
    for (const entry of pending) {
      const file = path.join(folder, `${entry.tag}.sql`);
      const sqlText = fs.readFileSync(file, "utf8");
      const statements = sqlText
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const stmt of statements) {
        try {
          await db.execute(sql.raw(stmt));
        } catch (err) {
          const code = pgCode(err);
          if (code && ALREADY_EXISTS_CODES.has(code)) {
            skippedExisting++;
            console.log(`[migrations] ${entry.tag}: object already exists (${code}) — skipping statement`);
            continue;
          }
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(`migration ${entry.tag} failed on: ${stmt.slice(0, 140).replace(/\s+/g, " ")}… → ${message}`);
        }
      }

      const hash = crypto.createHash("sha256").update(sqlText).digest("hex");
      await db.execute(sql`INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES (${hash}, ${entry.when})`);
      console.log(`[migrations] applied ${entry.tag}`);
    }

    const detail = `applied ${pending.length} migration(s)${skippedExisting > 0 ? ` (${skippedExisting} statements already present, skipped)` : ""} — folder=${folder}, in ${Date.now() - started}ms`;
    console.log(`[migrations] ${detail}`);
    return { ok: true, detail };
  } catch (err) {
    const detail = `folder=${folder}: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[migrations] FAILED — ${detail}`);
    return { ok: false, detail };
  }
}

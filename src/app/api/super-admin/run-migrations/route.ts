import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/permissions";
import { runBootMigrations } from "@/lib/boot-migrations";

// Platform Owner escape hatch: apply pending database migrations ON DEMAND
// and see the outcome (or the exact failure) in the Diagnostics UI, instead
// of depending on boot logs nobody is watching. Runs the same migrator the
// server runs at boot — idempotent, applies only what's pending.
export async function POST() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const result = await runBootMigrations();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

// Which build is actually LIVE — Render injects the deployed commit as
// RENDER_GIT_COMMIT. Shown in Diagnostics so "is my fix even deployed?"
// stops being guesswork.
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const commit = process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || "";
  return NextResponse.json({ commit: commit ? commit.slice(0, 7) : "unknown" });
}

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

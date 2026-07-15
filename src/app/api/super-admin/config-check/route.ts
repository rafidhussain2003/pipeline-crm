import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/permissions";
import { validateConfig } from "@/lib/health/config-validator";

// Production Config Validator (Phase 12) — checks required env/secrets are
// present and well-formed WITHOUT exposing any value. Super-admin only.
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  return NextResponse.json(validateConfig());
}

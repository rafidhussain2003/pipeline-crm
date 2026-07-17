// Phase 18 — reusable feature-gate helpers, one per calling context, all
// funneling into the same featureService (never a duplicated check):
//
//   requireFeature(feature)            — API routes (session + entitlement)
//   checkFeature(companyId, feature)   — server components / server actions
//   featureGateResponse(companyId, f)  — public endpoints that resolve the
//                                        company themselves (hosted forms)
import { NextResponse } from "next/server";
import { requireCompanySession, type CompanySession } from "@/lib/auth";
import { featureService } from "./service";
import type { FeatureKey } from "./registry";

export const FEATURE_DISABLED_MESSAGE = "Feature Not Enabled";

function disabledResponse(): NextResponse {
  return NextResponse.json({ error: FEATURE_DISABLED_MESSAGE }, { status: 403 });
}

// For any code that already knows the company (public endpoints, server
// actions holding a session): null = allowed, otherwise the 403 to return.
export async function featureGateResponse(companyId: string, feature: FeatureKey | string): Promise<NextResponse | null> {
  return (await featureService.isEnabled(companyId, feature)) ? null : disabledResponse();
}

// Plain boolean for server components ("render nothing if the module is off").
export async function checkFeature(companyId: string, feature: FeatureKey | string): Promise<boolean> {
  return featureService.isEnabled(companyId, feature);
}

// The API-route guard, shaped exactly like requirePermission() so routes wire
// it with the same two lines:
//   const auth = await requireFeature("callback_engine");
//   if (!auth.ok) return auth.response;
export async function requireFeature(
  feature: FeatureKey | string,
): Promise<{ ok: true; session: CompanySession } | { ok: false; response: NextResponse }> {
  const auth = await requireCompanySession();
  if (!auth.ok) return auth;
  if (!(await featureService.isEnabled(auth.session.companyId, feature))) {
    return { ok: false, response: disabledResponse() };
  }
  return auth;
}

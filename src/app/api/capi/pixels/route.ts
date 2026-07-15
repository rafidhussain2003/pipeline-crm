import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { listPixelConfigs, createPixelConfig } from "@/lib/capi";

export async function GET() {
  const session = await getSession();
  if (!session?.companyId || (session.role !== "admin" && session.role !== "manager")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const pixels = await listPixelConfigs(session.companyId);
  return NextResponse.json({ pixels });
}

// Save a selected pixel. Seeds default trigger→event mappings so it works
// immediately. accessToken (optional system-user token) is encrypted at rest.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.companyId || (session.role !== "admin" && session.role !== "manager")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  if (!body?.pixelId || typeof body.pixelId !== "string") return NextResponse.json({ error: "pixelId is required" }, { status: 400 });

  const id = await createPixelConfig({
    companyId: session.companyId,
    createdBy: session.userId,
    accountId: typeof body.accountId === "string" ? body.accountId : null,
    businessId: body.businessId ?? null,
    businessName: body.businessName ?? null,
    adAccountId: body.adAccountId ?? null,
    adAccountName: body.adAccountName ?? null,
    pixelId: body.pixelId,
    pixelName: body.pixelName ?? null,
    datasetId: body.datasetId ?? null,
    accessToken: typeof body.accessToken === "string" && body.accessToken.trim() ? body.accessToken.trim() : null,
    testEventCode: typeof body.testEventCode === "string" && body.testEventCode.trim() ? body.testEventCode.trim() : null,
  });

  await recordAudit({ companyId: session.companyId, userId: session.userId, action: "capi.pixel_connected", entityType: "capi_pixel", entityId: id, after: { pixelId: body.pixelId } });
  return NextResponse.json({ id });
}

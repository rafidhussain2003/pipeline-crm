import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getConnectedMetaAccounts } from "@/lib/capi";

// Connected Meta accounts available to attach a pixel to (reuses the existing
// Lead Ads OAuth). Admin/manager only — agents cannot configure CAPI.
export async function GET() {
  const session = await getSession();
  if (!session?.companyId || (session.role !== "admin" && session.role !== "manager")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const accounts = await getConnectedMetaAccounts(session.companyId);
  return NextResponse.json({ accounts });
}

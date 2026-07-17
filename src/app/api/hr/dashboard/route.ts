import { NextResponse } from "next/server";
import { requireHR } from "@/lib/hr/guard";
import { hrDashboard } from "@/lib/hr";

export async function GET() {
  const auth = await requireHR("hr:view");
  if (!auth.ok) return auth.response;
  return NextResponse.json(await hrDashboard(auth.session.companyId));
}

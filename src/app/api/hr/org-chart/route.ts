import { NextResponse } from "next/server";
import { requireHR } from "@/lib/hr/guard";
import { getOrgChart } from "@/lib/hr";

export async function GET() {
  const auth = await requireHR("hr:view");
  if (!auth.ok) return auth.response;
  return NextResponse.json({ roots: await getOrgChart(auth.session.companyId) });
}

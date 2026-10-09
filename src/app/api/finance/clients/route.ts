import { NextRequest, NextResponse } from "next/server";
import { requireFinance, financeErrorResponse } from "@/lib/finance/guard";
import { createClient, listClients } from "@/lib/finance";

// Billing clients — the "Bill To" party on invoices.
export async function GET(req: NextRequest) {
  const auth = await requireFinance("finance:view");
  if (!auth.ok) return auth.response;
  const includeInactive = req.nextUrl.searchParams.get("all") === "1";
  const clients = await listClients(auth.session.companyId, { includeInactive });
  return NextResponse.json({ clients });
}

export async function POST(req: NextRequest) {
  const auth = await requireFinance("finance:post");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  try {
    const client = await createClient(auth.session.companyId, auth.session.userId, body ?? {});
    return NextResponse.json({ client }, { status: 201 });
  } catch (err) {
    return financeErrorResponse(err);
  }
}

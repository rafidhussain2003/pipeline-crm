import { NextRequest, NextResponse } from "next/server";
import { requireFinance, financeErrorResponse } from "@/lib/finance/guard";
import { getClient, setClientActive, updateClient } from "@/lib/finance";
import { isUuid } from "@/lib/url";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFinance("finance:view");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const client = isUuid(id) ? await getClient(auth.session.companyId, id) : null;
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ client });
}

// Full edit, or { active: false } alone to archive (hide from the picker).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFinance("finance:post");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  try {
    const onlyActive = body && typeof body.active === "boolean" && Object.keys(body).length === 1;
    const client = onlyActive
      ? await setClientActive(auth.session.companyId, auth.session.userId, id, body.active)
      : await updateClient(auth.session.companyId, auth.session.userId, id, body ?? {});
    return NextResponse.json({ client });
  } catch (err) {
    return financeErrorResponse(err);
  }
}

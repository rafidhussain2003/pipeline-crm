import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createApiKey, listApiKeys } from "@/lib/api-keys";
import { recordAudit } from "@/lib/audit";
import { checkPolicy } from "@/lib/rate-limit";

export async function GET() {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const keys = await listApiKeys(session.companyId);
  return NextResponse.json({ apiKeys: keys });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !session.companyId || session.role !== "admin") {
    return NextResponse.json({ error: "Only company admins can create API keys" }, { status: 403 });
  }

  const rl = checkPolicy("api.admin", session.userId);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
  }

  const { name, scopes } = await req.json();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!Array.isArray(scopes) || scopes.length === 0) {
    return NextResponse.json({ error: "scopes must be a non-empty array" }, { status: 400 });
  }

  const created = await createApiKey(session.companyId, name, scopes, session.userId);

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "api_key.created",
    entityType: "api_key",
    entityId: created.id,
    after: { name: created.name, scopes: created.scopes, keyPrefix: created.keyPrefix },
  });

  // rawKey is only ever returned here — the caller must save it now.
  return NextResponse.json({ apiKey: created });
}

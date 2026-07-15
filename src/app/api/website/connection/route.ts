import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { getWebsiteSources, ensureWebsiteSource, ensureSecretKey, toConnection, updateAllowedDomains, baseUrl } from "@/lib/website";

// Website connection settings (Phase 8), admin-only. Exposes the public key,
// secret key, one-line SDK snippet, and allowed-domains list; lets an admin
// edit the allowed domains. This is the "settings surface" for the isolated
// Website Forms module — it touches only the company's website leadSources row.

export async function GET() {
  const session = await getSession();
  if (!session || !session.companyId || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const sources = await getWebsiteSources(session.companyId);
  if (sources.length === 0) {
    // Don't auto-create on a read — report "not set up yet" so the UI can show
    // a "Create website form" CTA instead.
    return NextResponse.json({ connection: null });
  }
  const source = sources[0];
  const secret = await ensureSecretKey(source); // backfill older connections
  const connection = toConnection({ ...source, webhookSecret: secret }, baseUrl());
  return NextResponse.json({ connection });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || !session.companyId || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const domains = Array.isArray(body?.allowedDomains) ? body.allowedDomains.filter((d: unknown): d is string => typeof d === "string") : null;
  if (!domains) return NextResponse.json({ error: "allowedDomains must be an array of strings." }, { status: 400 });

  // Ensure a connection exists so an admin can configure domains before
  // building a form.
  const source = await ensureWebsiteSource(session.companyId, session.userId);
  await updateAllowedDomains(source.id, session.companyId, domains);

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "website_connection.domains_updated",
    entityType: "lead_source",
    entityId: source.id,
    after: { count: domains.length },
  });

  const refreshed = (await getWebsiteSources(session.companyId)).find((s) => s.id === source.id)!;
  return NextResponse.json({ connection: toConnection(refreshed, baseUrl()) });
}

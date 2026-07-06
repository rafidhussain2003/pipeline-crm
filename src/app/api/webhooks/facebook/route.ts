import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leadSources, leads } from "@/db/schema";
import { eq } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { fetchFacebookLead } from "@/lib/facebook";
import { assignLead } from "@/lib/assignment";
import { checkPolicy, getClientIp } from "@/lib/rate-limit";

// --- Verification handshake (Facebook calls this once when you register the webhook) ---
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.FACEBOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

// --- Real-time leadgen events ---
// Facebook expects a fast 200 response. We do the minimum synchronous work
// needed (look up the source + fetch the lead) and return quickly; at higher
// volume this handler's body can be moved into a queue worker unchanged.
export async function POST(req: NextRequest) {
  // Generous limit — set well above real Facebook leadgen delivery volume,
  // this only exists to catch actual abuse (someone hammering the URL
  // directly), not to throttle legitimate webhook traffic.
  const rl = checkPolicy("webhook.facebook", getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  let body;
  try {
    body = await req.json();
  } catch (err) {
    // Log but still return 200 — Facebook retries aggressively on non-200s,
    // and we don't want a malformed payload to cause a retry storm.
    console.error("Facebook webhook: invalid JSON body:", err);
    return NextResponse.json({ received: true });
  }

  const entries = body.entry || [];
  for (const entry of entries) {
    const changes = entry.changes || [];
    for (const change of changes) {
      // Each entry is handled independently: one page's corrupted token or
      // one transient DB error shouldn't stop other entries in the same
      // delivery (potentially from other, healthy pages) from being
      // processed.
      try {
        if (change.field !== "leadgen") continue;
        const { leadgen_id, page_id } = change.value || {};
        if (!leadgen_id || !page_id) continue;

        const [source] = await db
          .select()
          .from(leadSources)
          .where(eq(leadSources.pageId, page_id))
          .limit(1);

        if (!source || !source.accessToken) continue;

        const token = decrypt(source.accessToken);
        const fbLead = await fetchFacebookLead(leadgen_id, token);

        const [lead] = await db
          .insert(leads)
          .values({
            companyId: source.companyId,
            sourceId: source.id,
            name: fbLead.name || "Unknown",
            phone: fbLead.phone,
            email: fbLead.email,
            disposition: "New Lead",
            rawPayload: fbLead.raw,
          })
          .returning();

        await assignLead(lead.id, source.companyId);
        await db.update(leadSources).set({ lastSyncedAt: new Date() }).where(eq(leadSources.id, source.id));
      } catch (err) {
        console.error("Facebook webhook: failed to process one leadgen entry:", err);
      }
    }
  }

  return NextResponse.json({ received: true });
}

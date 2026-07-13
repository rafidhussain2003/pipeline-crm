import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leadSources } from "@/db/schema";
import { eq } from "drizzle-orm";
import { mapPayloadToLead, FieldMapping } from "@/lib/field-mapping";
import { checkPolicy, getClientIp } from "@/lib/rate-limit";
import { recordDeliveryLog } from "@/lib/delivery-log";
import { ingestInboundLead } from "@/lib/lead-sources/ingest-inbound";

// Public Website-Forms endpoint. Submitted straight from a visitor's browser
// (the embed.js snippet's fetch, or a plain <form action="…"> POST), so —
// unlike the server-to-server generic webhook — it can't carry a secret. It
// is protected instead by a public-but-unguessable source id + a honeypot +
// dual rate limits + optional CAPTCHA, then feeds the SAME
// ingestInboundLead pipeline (dedup, assignment engine, Delivery Log) every
// other source uses. Designed for high volume: all work is a handful of
// bounded, indexed queries per submission; nothing is buffered in memory.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

// Preflight for the embed.js fetch (application/json is a non-simple request).
export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

// Fields the form platform uses for control, never treated as lead data.
const CONTROL_FIELDS = new Set(["_gotcha", "_honeypot", "_redirect", "_captcha", "captcha_token", "cf-turnstile-response", "h-captcha-response", "g-recaptcha-response", "_meta"]);

function parseDevice(ua: string): "mobile" | "tablet" | "desktop" {
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return "tablet";
  if (/Mobi|iPhone|Android.*Mobile|Windows Phone/i.test(ua)) return "mobile";
  return "desktop";
}
function parseBrowser(ua: string): string {
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  // "Safari/" on desktop, "Mobile Safari" / "Version/… Mobile" on iOS.
  if ((/Safari/.test(ua) || /Mobile\//.test(ua)) && !/Chrome|Chromium|Android/.test(ua)) return "Safari";
  return "Unknown";
}

async function readBody(req: NextRequest): Promise<{ fields: Record<string, unknown>; isForm: boolean }> {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return { fields: (await req.json().catch(() => ({}))) as Record<string, unknown>, isForm: false };
  }
  // application/x-www-form-urlencoded or multipart/form-data (plain <form>).
  const form = await req.formData().catch(() => null);
  const fields: Record<string, unknown> = {};
  if (form) for (const [k, v] of form.entries()) fields[k] = typeof v === "string" ? v : (v as File).name;
  return { fields, isForm: true };
}

// Optional CAPTCHA — verified only if the source has one configured in
// providerMetadata.captcha ({ provider, secret }); otherwise skipped, so a
// form works out of the box and CAPTCHA can be turned on later without code.
async function verifyCaptcha(source: typeof leadSources.$inferSelect, token: string | null, ip: string): Promise<boolean> {
  const meta = (source.providerMetadata as { captcha?: { provider: string; secret: string } } | null)?.captcha;
  if (!meta?.secret) return true; // not configured -> pass
  if (!token) return false;
  const endpoints: Record<string, string> = {
    turnstile: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    hcaptcha: "https://hcaptcha.com/siteverify",
    recaptcha: "https://www.google.com/recaptcha/api/siteverify",
  };
  const url = endpoints[meta.provider];
  if (!url) return true;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: meta.secret, response: token, remoteip: ip }),
    });
    const data = await res.json();
    return !!data.success;
  } catch {
    return false; // fail closed on a verifier outage
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ sourceId: string }> }) {
  const startedAt = Date.now();
  const { sourceId } = await params;
  const ip = getClientIp(req);

  // Dual rate limit: generous per-form, tight per-IP-per-form. Both must pass.
  if (!checkPolicy("forms.submit", sourceId).allowed || !checkPolicy("forms.submit.ip", `${sourceId}:${ip}`).allowed) {
    return NextResponse.json({ error: "Too many submissions. Please try again shortly." }, { status: 429, headers: CORS });
  }

  const [source] = await db.select().from(leadSources).where(eq(leadSources.id, sourceId)).limit(1);
  if (!source || source.status !== "connected" || source.platform !== "website") {
    return NextResponse.json({ error: "Unknown or inactive form" }, { status: 404, headers: CORS });
  }

  const { fields, isForm } = await readBody(req);
  const redirectTo = typeof fields._redirect === "string" ? fields._redirect : null;

  const done = (ok: boolean) => {
    // A plain <form> POST (no JS) gets a redirect back to a thank-you/referrer
    // so the visitor never sees raw JSON; the embed.js fetch gets JSON.
    if (isForm) {
      const target = redirectTo || req.headers.get("referer") || "/";
      return NextResponse.redirect(new URL(target, req.url), { status: 303, headers: CORS });
    }
    return NextResponse.json(ok ? { ok: true } : { ok: false }, { status: 200, headers: CORS });
  };

  // Honeypot: a hidden field real users never fill. If a bot filled it,
  // ACCEPT the request (200/redirect, so the bot sees success and moves on)
  // but silently create no lead.
  if ((typeof fields._gotcha === "string" && fields._gotcha) || (typeof fields._honeypot === "string" && fields._honeypot)) {
    return done(true);
  }

  const captchaToken =
    (fields._captcha as string) ||
    (fields["cf-turnstile-response"] as string) ||
    (fields["h-captcha-response"] as string) ||
    (fields["g-recaptcha-response"] as string) ||
    null;
  if (!(await verifyCaptcha(source, captchaToken, ip))) {
    await recordDeliveryLog({ sourceId: source.id, companyId: source.companyId, status: "failed", stage: "received", startedAt, error: "CAPTCHA verification failed" });
    return NextResponse.json({ error: "CAPTCHA verification failed" }, { status: 400, headers: CORS });
  }

  try {
    const mapping = (source.fieldMapping as FieldMapping) || { name: "name", phone: "phone", email: "email" };
    const mapped = mapPayloadToLead(fields, mapping);

    // Client-supplied _meta (from embed.js) plus server-derived signals.
    const clientMeta = (fields._meta && typeof fields._meta === "object" ? (fields._meta as Record<string, unknown>) : {}) as Record<string, unknown>;
    const ua = req.headers.get("user-agent") || "";
    const url = new URL(req.url);
    // UTM can arrive either in _meta (embed.js reads them off the page URL) or
    // as top-level fields on a hand-built form.
    const utm = {
      source: (clientMeta.utm_source as string) || (fields.utm_source as string) || null,
      medium: (clientMeta.utm_medium as string) || (fields.utm_medium as string) || null,
      campaign: (clientMeta.utm_campaign as string) || (fields.utm_campaign as string) || null,
      term: (clientMeta.utm_term as string) || (fields.utm_term as string) || null,
      content: (clientMeta.utm_content as string) || (fields.utm_content as string) || null,
    };

    // Everything the visitor submitted (custom + hidden fields), minus the
    // control fields, preserved verbatim on the lead.
    const submittedFields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) if (!CONTROL_FIELDS.has(k)) submittedFields[k] = v;

    const rawPayload = {
      fields: submittedFields,
      _meta: {
        utm,
        referrer: (clientMeta.referrer as string) || req.headers.get("referer") || null,
        landingPage: (clientMeta.landingPage as string) || null,
        ip,
        userAgent: ua,
        browser: parseBrowser(ua),
        device: parseDevice(ua),
        timezone: (clientMeta.timezone as string) || null,
        origin: req.headers.get("origin") || null,
        submittedAt: new Date().toISOString(),
        formId: source.id,
        formName: source.pageName,
        query: Object.fromEntries(url.searchParams.entries()),
      },
    };

    await ingestInboundLead({
      source,
      name: mapped.name ?? null,
      phone: mapped.phone ?? null,
      email: mapped.email ?? null,
      rawPayload,
      startedAt,
    });

    return done(true);
  } catch (err) {
    console.error("Website form processing error:", err);
    await recordDeliveryLog({ sourceId: source.id, companyId: source.companyId, status: "failed", stage: "received", startedAt, payload: fields, error: err instanceof Error ? err.message : "Unknown error" });
    return NextResponse.json({ error: "Could not process submission" }, { status: 500, headers: CORS });
  }
}

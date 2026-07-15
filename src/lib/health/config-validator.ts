// Phase 12 — production configuration validator. Checks that every environment
// variable / secret the platform needs is present and well-formed, WITHOUT ever
// exposing a value (only present/absent + validity). Powers the super-admin
// "Production Config" page so an operator can confirm a deploy is correctly
// configured before going live.
import { getPublicAppUrl } from "@/lib/url";

export type ConfigStatus = "healthy" | "warning" | "missing";
export interface ConfigCheck {
  name: string;
  status: ConfigStatus;
  detail: string;
  required: boolean;
}
export interface ConfigReport {
  status: ConfigStatus; // worst REQUIRED status (warnings on optional items don't fail the deploy)
  checks: ConfigCheck[];
  generatedAt: string;
}

const isSet = (v: string | undefined): boolean => !!v && v.trim().length > 0 && v.trim().toLowerCase() !== "placeholder";

export function validateConfig(): ConfigReport {
  const env = process.env;
  const checks: ConfigCheck[] = [];
  const add = (name: string, status: ConfigStatus, detail: string, required = true) => checks.push({ name, status, detail, required });

  // ── Core (required) ──────────────────────────────────────────────────────
  let appUrl = "";
  try {
    appUrl = getPublicAppUrl();
  } catch {
    /* ignore */
  }
  if (!appUrl) add("APP_URL", "missing", "APP_URL / NEXT_PUBLIC_APP_URL not set — OAuth + email links will break.");
  else if (appUrl.includes("localhost") || appUrl.startsWith("http://")) add("APP_URL", "warning", `${appUrl.replace(/\/$/, "")} — not an https production URL.`);
  else add("APP_URL", "healthy", "Public HTTPS URL configured.");

  add("DATABASE_URL", isSet(env.DATABASE_URL) ? "healthy" : "missing", isSet(env.DATABASE_URL) ? "Set (connectivity checked in System Health)." : "Not set — the app cannot start.");

  const jwt = env.JWT_SECRET;
  add("JWT_SECRET", !isSet(jwt) ? "missing" : (jwt as string).length < 24 ? "warning" : "healthy", !isSet(jwt) ? "Not set — sessions cannot be signed." : (jwt as string).length < 24 ? "Set but short (<24 chars) — use a longer random secret." : "Set (strong).");

  add("ENCRYPTION_KEY", isSet(env.ENCRYPTION_KEY) ? "healthy" : "missing", isSet(env.ENCRYPTION_KEY) ? "Set — tokens are encrypted at rest (AES-256-GCM)." : "Not set — Meta/CAPI tokens cannot be encrypted.");

  add("CRON_SECRET", isSet(env.CRON_SECRET) ? "healthy" : "warning", isSet(env.CRON_SECRET) ? "Set — cron backstops are authenticated." : "Not set — cron endpoints reject all calls, so queue backstops won't run on schedule.");

  // ── Meta (Lead Ads + Conversions API) ────────────────────────────────────
  const fbId = env.FACEBOOK_APP_ID;
  const fbSecret = env.FACEBOOK_APP_SECRET;
  const fbVerify = env.FACEBOOK_VERIFY_TOKEN;
  const fbIdValid = isSet(fbId) && /^\d+$/.test(fbId as string);
  const metaAll = fbIdValid && isSet(fbSecret) && isSet(fbVerify);
  add("Meta App (FACEBOOK_APP_ID/SECRET)", metaAll ? "healthy" : isSet(fbId) || isSet(fbSecret) ? "warning" : "warning",
    metaAll ? "Configured — Lead Ads OAuth, webhook signature verification, and Conversions API are all enabled."
      : !isSet(fbId) && !isSet(fbSecret) ? "Not configured — Meta Lead Ads + Conversions API are unavailable (optional per company)."
        : `Partial: ${fbIdValid ? "" : "APP_ID missing/invalid "}${isSet(fbSecret) ? "" : "APP_SECRET missing "}${isSet(fbVerify) ? "" : "VERIFY_TOKEN missing"}`.trim(), false);

  // ── Email (Resend — platform mailbox) ────────────────────────────────────
  add("RESEND_API_KEY", isSet(env.RESEND_API_KEY) ? "healthy" : "warning", isSet(env.RESEND_API_KEY) ? "Set — platform-owner mailbox can send." : "Not set — inbound mail is still stored, but outbound send is disabled.", false);

  // ── Billing (Stripe) ─────────────────────────────────────────────────────
  const stripeAll = isSet(env.STRIPE_SECRET_KEY) && isSet(env.STRIPE_WEBHOOK_SECRET);
  add("Stripe (billing)", stripeAll ? "healthy" : isSet(env.STRIPE_SECRET_KEY) ? "warning" : "warning",
    stripeAll ? "Configured — subscriptions + webhooks enabled." : isSet(env.STRIPE_SECRET_KEY) ? "Secret key set but STRIPE_WEBHOOK_SECRET missing — subscription status won't sync." : "Not configured — billing/subscriptions disabled (trials still work).", false);

  // ── AI provider (optional; deterministic engine works without it) ────────
  const aiProvider = env.AI_PROVIDER;
  add("AI_PROVIDER", "healthy", isSet(aiProvider) && aiProvider !== "none" ? `Set to "${aiProvider}" (natural-language features enabled).` : "Not set — AI scoring/insights run on the deterministic engine (no external LLM needed).", false);

  // ── Storage ──────────────────────────────────────────────────────────────
  add("Storage", "healthy", "No object storage required — lead attachments are external URLs (Drive/Dropbox links), not uploaded files.", false);

  const requiredWorst = checks.filter((c) => c.required).reduce<ConfigStatus>((acc, c) => (rank(c.status) > rank(acc) ? c.status : acc), "healthy");
  return { status: requiredWorst, checks, generatedAt: new Date().toISOString() };
}

function rank(s: ConfigStatus): number {
  return s === "missing" ? 2 : s === "warning" ? 1 : 0;
}

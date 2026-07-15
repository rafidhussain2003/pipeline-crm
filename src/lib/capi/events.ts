// Phase 11 — build a Meta Conversions API event object from a CRM lead. All PII
// is hashed here (via ./hashing); the returned event + stored payload contain
// only hashed values + non-PII signals. The event_id is deterministic per
// (lead, trigger, event) so a resend — live retry OR historical export — is
// deduplicated by Meta and by our own unique index.
import { buildUserData, splitName, type RawPii } from "./hashing";
import { rateEmq, type EmqRating } from "./emq";

export interface LeadForEvent {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  state: string | null;
  rawPayload: unknown;
  createdAt: Date;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

// Pull every match signal we can from the lead + its captured raw payload
// (website leads capture ip/userAgent, and sometimes city/zip/fbp/fbc).
export function extractPii(lead: LeadForEvent): RawPii {
  const raw = (lead.rawPayload && typeof lead.rawPayload === "object" ? (lead.rawPayload as Record<string, unknown>) : {}) as Record<string, unknown>;
  const meta = (raw._meta && typeof raw._meta === "object" ? (raw._meta as Record<string, unknown>) : {}) as Record<string, unknown>;
  const fields = (raw.fields && typeof raw.fields === "object" ? (raw.fields as Record<string, unknown>) : {}) as Record<string, unknown>;
  const { firstName, lastName } = splitName(lead.name);
  return {
    email: lead.email,
    phone: lead.phone,
    firstName,
    lastName,
    state: lead.state,
    city: str(fields.city) || str(meta.city),
    zip: str(fields.zip) || str(fields.postal) || str(fields.postcode) || str(meta.zip),
    country: str(fields.country) || str(meta.country),
    externalId: lead.id,
    clientIp: str(meta.ip),
    userAgent: str(meta.userAgent),
    fbp: str(meta.fbp) || str(fields.fbp) || str(fields._fbp),
    fbc: str(meta.fbc) || str(fields.fbc) || str(fields._fbc),
  };
}

export interface BuiltEvent {
  eventId: string;
  eventName: string;
  event: Record<string, unknown>;
  matchKeys: string[];
  emq: EmqRating;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
}

export function buildMetaEvent(params: {
  lead: LeadForEvent;
  eventName: string;
  trigger: string;
  eventTimeMs: number;
  actionSource?: string;
}): BuiltEvent {
  const { lead, eventName, trigger, eventTimeMs } = params;
  const { userData, matchKeys } = buildUserData(extractPii(lead));
  const { rating } = rateEmq(matchKeys);
  const eventId = `${lead.id}:${slug(trigger)}:${slug(eventName)}`.slice(0, 200);

  const event: Record<string, unknown> = {
    event_name: eventName,
    event_time: Math.floor(eventTimeMs / 1000),
    event_id: eventId,
    action_source: params.actionSource || "system_generated",
    user_data: userData,
    custom_data: {
      lead_event_source: "Ziplod CRM",
      event_source: "crm",
    },
  };

  return { eventId, eventName, event, matchKeys, emq: rating };
}

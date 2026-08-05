-- Sales Ledger V2 — optional 4-digit login PIN (a second unlock layer) + the
-- admin "require agents to set a PIN" toggle + the pin_reset OTP purpose.
-- Additive and idempotent; no existing auth behavior changes (Remember-Me and
-- the session JWT are untouched — the unlock lives in a separate cookie).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pin_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pin_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "require_agent_pin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TYPE "verification_purpose" ADD VALUE IF NOT EXISTS 'pin_reset';

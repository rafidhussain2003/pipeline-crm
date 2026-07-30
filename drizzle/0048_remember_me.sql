-- Durable "Remember Me": record the remember-me choice on the refresh token
-- so a session RENEWAL re-issues with the same 30-day horizon instead of
-- silently reverting to the 7-day default. Additive, safe default (false =
-- the previous behavior for any pre-existing token).
ALTER TABLE "refresh_tokens" ADD COLUMN IF NOT EXISTS "remember_me" boolean DEFAULT false NOT NULL;

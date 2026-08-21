-- Secure Notepad retention model: sensitive values are now kept READABLE for a
-- 12h window (stored encrypted at rest) then auto-erased. sensitive_meta holds
-- the per-value retention clock — { hmac(value): { kind, t } } — with NO
-- sensitive value in it. Additive + idempotent.
ALTER TABLE "notepad_notes" ADD COLUMN IF NOT EXISTS "sensitive_meta" jsonb;

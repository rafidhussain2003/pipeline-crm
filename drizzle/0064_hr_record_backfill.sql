-- One-time repair of accounts HR created BEFORE the hr_record role existed:
-- they were minted as real agents and leaked into the CRM roster. Kept in its
-- own migration (after 0063) so the enum value is committed before it is used.
-- Converts to hr_record ONLY the accounts that (a) HR created the login for
-- (the hr.employee_created audit row says createdLogin=true and names the
-- user), (b) are still plain agents, and (c) have NEVER been used — the
-- temporary password was never changed (must_change_password still true), no
-- presence heartbeat, no lead ever assigned. A genuine agent who also has an
-- HR profile (they log in, take leads) is untouched. Idempotent.
UPDATE "users"
SET "role" = 'hr_record', "active" = false,
    "module_access" = '{"crm":false,"hr":false,"finance":false,"attendance":false,"payroll":false,"workflow":false}'::jsonb
WHERE "role" = 'agent'
  AND "must_change_password" = true
  AND "last_heartbeat_at" IS NULL
  AND "last_assigned_at" IS NULL
  AND "deleted_at" IS NULL
  AND "id" IN (SELECT e."user_id" FROM "hr_employees" e WHERE e."user_id" IS NOT NULL)
  AND "id" IN (
    SELECT (a."metadata"->'after'->>'userId')::uuid
    FROM "audit_log" a
    WHERE a."action" = 'hr.employee_created'
      AND a."metadata"->>'createdLogin' = 'true'
      AND a."metadata"->'after'->>'userId' IS NOT NULL
  );

-- Add the "Call Back", "In Progress" and "Disconnected" dispositions to the
-- default taxonomy for EVERY existing company (new companies get them from
-- the signup seed via DEFAULT_DISPOSITIONS). Idempotent via the
-- (company_id, label) unique index: companies that already created any of
-- these labels themselves keep their own row untouched (DO NOTHING — never
-- overwrite an admin's custom category/color choice).
INSERT INTO "disposition_options" ("company_id", "label", "color", "sort_order", "category")
SELECT c."id", d."label", d."color", d."sort_order", d."category"
FROM "companies" c
CROSS JOIN (
  VALUES
    ('Disconnected', '#d97706', 16, 'CONTACT ATTEMPT'),
    ('Call Back', '#0891b2', 24, 'INTERESTED'),
    ('In Progress', '#0891b2', 25, 'INTERESTED')
) AS d ("label", "color", "sort_order", "category")
ON CONFLICT ("company_id", "label") DO NOTHING;

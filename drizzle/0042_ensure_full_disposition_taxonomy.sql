-- Ensure the COMPLETE disposition taxonomy exists for every company, with
-- correct categories and sort orders — the same upsert shape migration 0037
-- used. This repairs rows that were seeded by the request-time self-heal
-- BEFORE the category column existed (they landed in OTHER) and guarantees
-- Call Back / In Progress / Wrong Number / Disconnected / High Price /
-- Hung Up / Do Not Call are present and correctly grouped everywhere.
-- Admin-created custom labels are untouched (only taxonomy labels appear
-- below); colors are preserved as stored.
INSERT INTO "disposition_options" ("company_id", "label", "color", "sort_order", "category")
SELECT c."id", d."label", d."color", d."sort_order", d."category"
FROM "companies" c
CROSS JOIN (
  VALUES
    ('New Lead', '#2563eb', 0, 'NEW'),
    ('No Answer', '#d97706', 10, 'CONTACT ATTEMPT'),
    ('Busy', '#d97706', 11, 'CONTACT ATTEMPT'),
    ('Hung Up', '#d97706', 12, 'CONTACT ATTEMPT'),
    ('Voicemail Left', '#d97706', 13, 'CONTACT ATTEMPT'),
    ('Wrong Number', '#d97706', 14, 'CONTACT ATTEMPT'),
    ('Disconnected', '#d97706', 16, 'CONTACT ATTEMPT'),
    ('Interested', '#0891b2', 20, 'INTERESTED'),
    ('Follow-up Scheduled', '#0891b2', 21, 'INTERESTED'),
    ('Call Back Later', '#0891b2', 22, 'INTERESTED'),
    ('Call Back', '#0891b2', 24, 'INTERESTED'),
    ('In Progress', '#0891b2', 25, 'INTERESTED'),
    ('Sale Closed', '#16a34a', 30, 'SALES'),
    ('Installation Scheduled', '#16a34a', 31, 'SALES'),
    ('High Price', '#dc2626', 40, 'LOST'),
    ('Not Interested', '#dc2626', 41, 'LOST'),
    ('Already Has Service', '#dc2626', 42, 'LOST'),
    ('Competitor Chosen', '#dc2626', 43, 'LOST'),
    ('Credit Declined', '#dc2626', 44, 'LOST'),
    ('Duplicate Lead', '#dc2626', 45, 'LOST'),
    ('Out of Service Area', '#dc2626', 46, 'LOST'),
    ('Do Not Call', '#64748b', 50, 'OTHER'),
    ('Invalid Lead', '#64748b', 51, 'OTHER')
) AS d ("label", "color", "sort_order", "category")
ON CONFLICT ("company_id", "label")
DO UPDATE SET "category" = EXCLUDED."category", "sort_order" = EXCLUDED."sort_order";

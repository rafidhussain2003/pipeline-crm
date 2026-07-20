ALTER TABLE "disposition_options" ADD COLUMN "category" varchar(40) DEFAULT 'OTHER' NOT NULL;
--> statement-breakpoint
-- Data migration: Enterprise Dispositions (feature/manual-lead-assignment).
--
-- 1) Categorize the legacy seeded labels in place. Existing leads reference
--    dispositions by LABEL, so legacy options are never deleted or renamed —
--    they are slotted into the taxonomy's categories and sort ranges (see
--    src/lib/dispositions/taxonomy.ts for the ranges).
UPDATE "disposition_options" SET "category" = 'NEW', "sort_order" = 0 WHERE "label" = 'New Lead';
--> statement-breakpoint
UPDATE "disposition_options" SET "category" = 'CONTACT ATTEMPT', "sort_order" = 15 WHERE "label" = 'Answering Machine';
--> statement-breakpoint
UPDATE "disposition_options" SET "category" = 'INTERESTED', "sort_order" = 23 WHERE "label" = 'Qualified';
--> statement-breakpoint
UPDATE "disposition_options" SET "category" = 'SALES', "sort_order" = 32 WHERE "label" = 'Sold';
--> statement-breakpoint
UPDATE "disposition_options" SET "category" = 'LOST', "sort_order" = 41 WHERE "label" = 'Not Interested';
--> statement-breakpoint
-- 2) Seed the full enterprise taxonomy for EVERY existing company. The
--    (company_id, label) unique index makes this idempotent: labels a company
--    already has (seeded or admin-created) are re-categorized/re-ordered
--    rather than duplicated, and their color is left as the company set it.
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
    ('Interested', '#0891b2', 20, 'INTERESTED'),
    ('Follow-up Scheduled', '#0891b2', 21, 'INTERESTED'),
    ('Call Back Later', '#0891b2', 22, 'INTERESTED'),
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

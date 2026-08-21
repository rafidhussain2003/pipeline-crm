-- Secure Notepad — multiple named tabs per user. A user now has MANY notes
-- (tabs), each with its own title + order, so the unique(company,user)
-- constraint is dropped for a plain lookup index. Existing single notes become
-- the user's first tab ("Note 1"). Additive + idempotent.
ALTER TABLE "notepad_notes" ADD COLUMN IF NOT EXISTS "title" varchar(200) DEFAULT 'Note 1' NOT NULL;--> statement-breakpoint
ALTER TABLE "notepad_notes" ADD COLUMN IF NOT EXISTS "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "notepad_notes_company_user_uniq";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notepad_notes_company_user_idx" ON "notepad_notes" USING btree ("company_id","user_id");

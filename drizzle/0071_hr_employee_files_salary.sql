CREATE TABLE IF NOT EXISTS "hr_document_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hr_document_files_document_id_unique" UNIQUE("document_id")
);
--> statement-breakpoint
ALTER TABLE "hr_documents" ADD COLUMN IF NOT EXISTS "file_name" varchar(255);--> statement-breakpoint
ALTER TABLE "hr_documents" ADD COLUMN IF NOT EXISTS "mime_type" varchar(100);--> statement-breakpoint
ALTER TABLE "hr_documents" ADD COLUMN IF NOT EXISTS "file_size" integer;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "salary_structure" jsonb;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hr_document_files" ADD CONSTRAINT "hr_document_files_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hr_document_files" ADD CONSTRAINT "hr_document_files_document_id_hr_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."hr_documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

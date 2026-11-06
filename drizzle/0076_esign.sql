-- E-Sign: documents, files (bytea), signers (secret tokens), fields, events. Additive + idempotent.
DO $$ BEGIN
 CREATE TYPE "public"."esign_doc_status" AS ENUM('draft', 'sent', 'completed', 'voided');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."esign_field_type" AS ENUM('signature', 'initials', 'date', 'text', 'checkbox');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."esign_signer_status" AS ENUM('pending', 'sent', 'viewed', 'signed', 'declined');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "esign_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"file_size" integer NOT NULL,
	"page_count" integer DEFAULT 1 NOT NULL,
	"status" "esign_doc_status" DEFAULT 'draft' NOT NULL,
	"message" text,
	"created_by" uuid,
	"sent_at" timestamp,
	"completed_at" timestamp,
	"voided_at" timestamp,
	"void_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "esign_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"signer_id" uuid,
	"kind" varchar(32) NOT NULL,
	"detail" text,
	"ip_address" varchar(64),
	"user_agent" varchar(300),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "esign_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"signer_id" uuid NOT NULL,
	"type" "esign_field_type" NOT NULL,
	"page" integer NOT NULL,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"w" double precision NOT NULL,
	"h" double precision NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"label" varchar(80),
	"value" text,
	"filled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "esign_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "esign_signers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"email" varchar(200) NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"color" varchar(7) DEFAULT '#2563eb' NOT NULL,
	"token" varchar(64) NOT NULL,
	"status" "esign_signer_status" DEFAULT 'pending' NOT NULL,
	"signature_data" text,
	"initials_data" text,
	"sent_at" timestamp,
	"viewed_at" timestamp,
	"signed_at" timestamp,
	"declined_at" timestamp,
	"decline_reason" text,
	"ip_address" varchar(64),
	"user_agent" varchar(300),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "esign_signers_token_unique" UNIQUE("token")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "esign_documents" ADD CONSTRAINT "esign_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "esign_documents" ADD CONSTRAINT "esign_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "esign_events" ADD CONSTRAINT "esign_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "esign_events" ADD CONSTRAINT "esign_events_document_id_esign_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."esign_documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "esign_events" ADD CONSTRAINT "esign_events_signer_id_esign_signers_id_fk" FOREIGN KEY ("signer_id") REFERENCES "public"."esign_signers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "esign_fields" ADD CONSTRAINT "esign_fields_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "esign_fields" ADD CONSTRAINT "esign_fields_document_id_esign_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."esign_documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "esign_fields" ADD CONSTRAINT "esign_fields_signer_id_esign_signers_id_fk" FOREIGN KEY ("signer_id") REFERENCES "public"."esign_signers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "esign_files" ADD CONSTRAINT "esign_files_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "esign_files" ADD CONSTRAINT "esign_files_document_id_esign_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."esign_documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "esign_signers" ADD CONSTRAINT "esign_signers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "esign_signers" ADD CONSTRAINT "esign_signers_document_id_esign_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."esign_documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "esign_documents_company_idx" ON "esign_documents" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "esign_events_document_idx" ON "esign_events" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "esign_fields_document_idx" ON "esign_fields" USING btree ("document_id","page");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "esign_files_document_kind_uniq" ON "esign_files" USING btree ("document_id","kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "esign_signers_document_idx" ON "esign_signers" USING btree ("document_id","position");
-- Docusign share links: a 24-hour link anyone can open to sign their own copy. Additive + idempotent.
CREATE TABLE IF NOT EXISTS "esign_share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"signer_id" uuid NOT NULL,
	"token" varchar(64) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"uses" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "esign_share_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "esign_documents" ADD COLUMN IF NOT EXISTS "parent_document_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "esign_share_links" ADD CONSTRAINT "esign_share_links_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "esign_share_links" ADD CONSTRAINT "esign_share_links_document_id_esign_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."esign_documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "esign_share_links" ADD CONSTRAINT "esign_share_links_signer_id_esign_signers_id_fk" FOREIGN KEY ("signer_id") REFERENCES "public"."esign_signers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "esign_share_links" ADD CONSTRAINT "esign_share_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "esign_share_links_document_idx" ON "esign_share_links" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "esign_documents_parent_idx" ON "esign_documents" USING btree ("parent_document_id");

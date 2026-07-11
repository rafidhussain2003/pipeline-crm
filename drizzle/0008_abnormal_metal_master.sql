CREATE TYPE "public"."connected_account_status" AS ENUM('connected', 'token_expired', 'permission_revoked', 'error', 'disconnected');--> statement-breakpoint
CREATE TABLE "connected_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"platform" "source_platform" NOT NULL,
	"external_account_id" varchar(255) NOT NULL,
	"account_label" varchar(255),
	"status" "connected_account_status" DEFAULT 'connected' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "lead_sources" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connected_accounts_company_idx" ON "connected_accounts" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connected_accounts_unique" ON "connected_accounts" USING btree ("company_id","platform","external_account_id");--> statement-breakpoint
ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_account_id_connected_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_sources_account_idx" ON "lead_sources" USING btree ("account_id");
CREATE TABLE "hosted_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"fields" jsonb NOT NULL,
	"submit_text" varchar(100) DEFAULT 'Submit' NOT NULL,
	"success_message" text,
	"redirect_url" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "hosted_forms" ADD CONSTRAINT "hosted_forms_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hosted_forms" ADD CONSTRAINT "hosted_forms_source_id_lead_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."lead_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hosted_forms" ADD CONSTRAINT "hosted_forms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hosted_forms_company_idx" ON "hosted_forms" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "hosted_forms_source_idx" ON "hosted_forms" USING btree ("source_id");
CREATE TYPE "public"."capi_event_status" AS ENUM('pending', 'processing', 'sent', 'failed', 'dead_letter');--> statement-breakpoint
CREATE TABLE "capi_event_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"pixel_id" uuid NOT NULL,
	"trigger" varchar(120) NOT NULL,
	"meta_event" varchar(120),
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capi_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"pixel_config_id" uuid NOT NULL,
	"lead_id" uuid,
	"event_name" varchar(120) NOT NULL,
	"event_id" varchar(200) NOT NULL,
	"event_time" timestamp NOT NULL,
	"action_source" varchar(40) DEFAULT 'system_generated' NOT NULL,
	"trigger" varchar(120),
	"origin" varchar(20) DEFAULT 'live' NOT NULL,
	"status" "capi_event_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 8 NOT NULL,
	"available_at" timestamp DEFAULT now() NOT NULL,
	"locked_at" timestamp,
	"locked_by" varchar(100),
	"payload" jsonb,
	"match_keys" jsonb,
	"event_match_quality" varchar(20),
	"http_status" integer,
	"meta_response" jsonb,
	"latency_ms" integer,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capi_pixels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"account_id" uuid,
	"business_id" varchar(255),
	"business_name" varchar(255),
	"ad_account_id" varchar(255),
	"ad_account_name" varchar(255),
	"pixel_id" varchar(255) NOT NULL,
	"pixel_name" varchar(255),
	"dataset_id" varchar(255),
	"access_token" text,
	"test_event_code" varchar(100),
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD COLUMN "access_token" text;--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD COLUMN "token_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "capi_event_mappings" ADD CONSTRAINT "capi_event_mappings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capi_event_mappings" ADD CONSTRAINT "capi_event_mappings_pixel_id_capi_pixels_id_fk" FOREIGN KEY ("pixel_id") REFERENCES "public"."capi_pixels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capi_events" ADD CONSTRAINT "capi_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capi_events" ADD CONSTRAINT "capi_events_pixel_config_id_capi_pixels_id_fk" FOREIGN KEY ("pixel_config_id") REFERENCES "public"."capi_pixels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capi_events" ADD CONSTRAINT "capi_events_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capi_pixels" ADD CONSTRAINT "capi_pixels_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capi_pixels" ADD CONSTRAINT "capi_pixels_account_id_connected_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capi_pixels" ADD CONSTRAINT "capi_pixels_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "capi_mappings_pixel_trigger_uniq" ON "capi_event_mappings" USING btree ("pixel_id","trigger");--> statement-breakpoint
CREATE INDEX "capi_mappings_company_idx" ON "capi_event_mappings" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "capi_events_due_idx" ON "capi_events" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "capi_events_company_created_idx" ON "capi_events" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "capi_events_lead_idx" ON "capi_events" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "capi_events_pixel_event_uniq" ON "capi_events" USING btree ("pixel_config_id","event_id");--> statement-breakpoint
CREATE INDEX "capi_pixels_company_idx" ON "capi_pixels" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "capi_pixels_company_pixel_uniq" ON "capi_pixels" USING btree ("company_id","pixel_id") WHERE deleted_at is null;
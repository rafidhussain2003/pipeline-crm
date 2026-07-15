CREATE TABLE "lead_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"score_label" varchar(40) NOT NULL,
	"temperature" varchar(10) NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text NOT NULL,
	"recommendation" varchar(40) NOT NULL,
	"recommendation_label" varchar(60) NOT NULL,
	"recommendation_reason" text NOT NULL,
	"follow_up_at" timestamp,
	"follow_up_label" varchar(60) NOT NULL,
	"explanation" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"factors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "lead_insights_lead_id_unique" UNIQUE("lead_id")
);
--> statement-breakpoint
ALTER TABLE "lead_insights" ADD CONSTRAINT "lead_insights_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_insights" ADD CONSTRAINT "lead_insights_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_insights_company_idx" ON "lead_insights" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "lead_insights_temperature_idx" ON "lead_insights" USING btree ("company_id","temperature");
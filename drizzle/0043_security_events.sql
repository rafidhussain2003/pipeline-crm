CREATE TABLE "security_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event" varchar(60) NOT NULL,
	"risk_level" varchar(10) DEFAULT 'low' NOT NULL,
	"email" varchar(255),
	"ip" varchar(64),
	"user_agent" varchar(255),
	"company_id" uuid,
	"user_id" uuid,
	"reason" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "security_events_created_idx" ON "security_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "security_events_event_created_idx" ON "security_events" USING btree ("event","created_at");--> statement-breakpoint
CREATE INDEX "security_events_ip_created_idx" ON "security_events" USING btree ("ip","created_at");--> statement-breakpoint
CREATE INDEX "security_events_email_created_idx" ON "security_events" USING btree ("email","created_at");
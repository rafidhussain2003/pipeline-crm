CREATE TYPE "public"."callback_reminder_status" AS ENUM('pending', 'processing', 'sent', 'failed', 'dead_letter', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."callback_status" AS ENUM('scheduled', 'due', 'completed', 'missed', 'cancelled', 'rescheduled');--> statement-breakpoint
CREATE TABLE "callback_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"callback_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"type" varchar(30) NOT NULL,
	"actor_user_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "callback_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"callback_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"offset_minutes" integer NOT NULL,
	"kind" varchar(30) NOT NULL,
	"due_at" timestamp NOT NULL,
	"channel" varchar(20) DEFAULT 'in_app' NOT NULL,
	"status" "callback_reminder_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"available_at" timestamp DEFAULT now() NOT NULL,
	"locked_at" timestamp,
	"locked_by" varchar(100),
	"sent_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "callback_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"reminder_offsets" jsonb DEFAULT '[-15,-5,0,15,60]'::jsonb NOT NULL,
	"escalate_after_minutes" integer DEFAULT 30 NOT NULL,
	"notify_manager" boolean DEFAULT true NOT NULL,
	"notify_admin" boolean DEFAULT false NOT NULL,
	"sound_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "callback_settings_company_id_unique" UNIQUE("company_id")
);
--> statement-breakpoint
CREATE TABLE "callbacks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"created_by" uuid,
	"scheduled_at" timestamp NOT NULL,
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"reason" varchar(60) NOT NULL,
	"notes" text,
	"priority" varchar(20) DEFAULT 'normal' NOT NULL,
	"status" "callback_status" DEFAULT 'scheduled' NOT NULL,
	"acknowledged_at" timestamp,
	"completed_at" timestamp,
	"cancelled_at" timestamp,
	"missed_at" timestamp,
	"escalated_at" timestamp,
	"rescheduled_from_id" uuid,
	"reschedule_count" integer DEFAULT 0 NOT NULL,
	"priority_score" real DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "callback_events" ADD CONSTRAINT "callback_events_callback_id_callbacks_id_fk" FOREIGN KEY ("callback_id") REFERENCES "public"."callbacks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callback_events" ADD CONSTRAINT "callback_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callback_events" ADD CONSTRAINT "callback_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callback_reminders" ADD CONSTRAINT "callback_reminders_callback_id_callbacks_id_fk" FOREIGN KEY ("callback_id") REFERENCES "public"."callbacks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callback_reminders" ADD CONSTRAINT "callback_reminders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callback_reminders" ADD CONSTRAINT "callback_reminders_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callback_settings" ADD CONSTRAINT "callback_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callbacks" ADD CONSTRAINT "callbacks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callbacks" ADD CONSTRAINT "callbacks_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callbacks" ADD CONSTRAINT "callbacks_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callbacks" ADD CONSTRAINT "callbacks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "callback_events_callback_idx" ON "callback_events" USING btree ("callback_id","created_at");--> statement-breakpoint
CREATE INDEX "callback_events_company_idx" ON "callback_events" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "callback_reminders_due_idx" ON "callback_reminders" USING btree ("status","available_at","due_at");--> statement-breakpoint
CREATE INDEX "callback_reminders_callback_idx" ON "callback_reminders" USING btree ("callback_id");--> statement-breakpoint
CREATE UNIQUE INDEX "callback_reminders_unique" ON "callback_reminders" USING btree ("callback_id","kind","channel");--> statement-breakpoint
CREATE INDEX "callbacks_company_scheduled_idx" ON "callbacks" USING btree ("company_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "callbacks_agent_status_idx" ON "callbacks" USING btree ("agent_id","status","scheduled_at");--> statement-breakpoint
CREATE INDEX "callbacks_status_scheduled_idx" ON "callbacks" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "callbacks_lead_idx" ON "callbacks" USING btree ("lead_id");
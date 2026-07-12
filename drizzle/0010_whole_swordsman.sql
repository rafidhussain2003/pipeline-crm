CREATE TYPE "public"."webhook_stage" AS ENUM('received', 'lead_downloaded', 'lead_stored', 'lead_assigned', 'completed');--> statement-breakpoint
ALTER TYPE "public"."webhook_log_status" ADD VALUE 'skipped';--> statement-breakpoint
ALTER TABLE "webhook_logs" ADD COLUMN "stage" "webhook_stage";--> statement-breakpoint
ALTER TABLE "webhook_logs" ADD COLUMN "lead_id" uuid;--> statement-breakpoint
ALTER TABLE "webhook_logs" ADD COLUMN "form_id" varchar(255);--> statement-breakpoint
ALTER TABLE "webhook_logs" ADD COLUMN "processing_time_ms" integer;--> statement-breakpoint
ALTER TABLE "webhook_logs" ADD COLUMN "webhook_latency_ms" integer;--> statement-breakpoint
ALTER TABLE "webhook_logs" ADD CONSTRAINT "webhook_logs_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leads_source_idx" ON "leads" USING btree ("source_id");
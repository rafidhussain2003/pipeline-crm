ALTER TABLE "hosted_forms" ADD COLUMN "agent_display_name" varchar(255);--> statement-breakpoint
ALTER TABLE "lead_forms" ADD COLUMN "agent_display_name" varchar(255);--> statement-breakpoint
ALTER TABLE "lead_sources" ADD COLUMN "agent_display_name" varchar(255);
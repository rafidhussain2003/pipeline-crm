ALTER TABLE "assignment_history" ADD COLUMN "final_score" real;--> statement-breakpoint
ALTER TABLE "assignment_history" ADD COLUMN "decision_detail" jsonb;--> statement-breakpoint
ALTER TABLE "automation_settings" ADD COLUMN "ai_config" jsonb;
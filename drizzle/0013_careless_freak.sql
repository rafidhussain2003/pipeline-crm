ALTER TYPE "public"."assignment_mode" ADD VALUE 'tier_based';--> statement-breakpoint
ALTER TYPE "public"."assignment_mode" ADD VALUE 'priority_based';--> statement-breakpoint
ALTER TYPE "public"."assignment_mode" ADD VALUE 'last_assigned';--> statement-breakpoint
ALTER TYPE "public"."assignment_mode" ADD VALUE 'least_active';--> statement-breakpoint
ALTER TYPE "public"."assignment_mode" ADD VALUE 'most_available';--> statement-breakpoint
ALTER TYPE "public"."assignment_mode" ADD VALUE 'random';--> statement-breakpoint
ALTER TYPE "public"."assignment_mode" ADD VALUE 'ai';--> statement-breakpoint
ALTER TYPE "public"."presence_status" ADD VALUE 'away';--> statement-breakpoint
ALTER TYPE "public"."presence_status" ADD VALUE 'lunch';--> statement-breakpoint
ALTER TYPE "public"."presence_status" ADD VALUE 'wrap_up';--> statement-breakpoint
ALTER TYPE "public"."presence_status" ADD VALUE 'locked';--> statement-breakpoint
ALTER TABLE "assignment_log" ADD COLUMN "status" varchar(20) DEFAULT 'assigned' NOT NULL;--> statement-breakpoint
ALTER TABLE "assignment_log" ADD COLUMN "presence_status" varchar(20);--> statement-breakpoint
ALTER TABLE "assignment_log" ADD COLUMN "latency_ms" integer;--> statement-breakpoint
ALTER TABLE "assignment_log" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_assigned_at" timestamp;
ALTER TYPE "public"."role" ADD VALUE 'manager' BEFORE 'agent';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone" varchar(50);
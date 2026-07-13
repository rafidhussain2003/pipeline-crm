CREATE TYPE "public"."email_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."email_folder" AS ENUM('inbox', 'sent', 'drafts', 'trash', 'archive');--> statement-breakpoint
CREATE TABLE "email_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"filename" varchar(255) NOT NULL,
	"content_type" varchar(255),
	"size" integer,
	"content_base64" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"color" varchar(20) DEFAULT '#64748b' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_labels_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "email_message_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"label_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"direction" "email_direction" NOT NULL,
	"folder" "email_folder" DEFAULT 'inbox' NOT NULL,
	"from_address" varchar(255) NOT NULL,
	"to_addresses" jsonb NOT NULL,
	"cc_addresses" jsonb,
	"bcc_addresses" jsonb,
	"subject" text,
	"html_body" text,
	"text_body" text,
	"snippet" varchar(255),
	"message_id_header" varchar(998),
	"in_reply_to" varchar(998),
	"references_header" jsonb,
	"provider_id" varchar(255),
	"is_read" boolean DEFAULT false NOT NULL,
	"is_starred" boolean DEFAULT false NOT NULL,
	"is_draft" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "email_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"subject" text,
	"last_message_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailboxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address" varchar(255) NOT NULL,
	"display_name" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mailboxes_address_unique" UNIQUE("address")
);
--> statement-breakpoint
ALTER TABLE "email_attachments" ADD CONSTRAINT "email_attachments_message_id_email_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."email_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_message_labels" ADD CONSTRAINT "email_message_labels_message_id_email_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."email_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_message_labels" ADD CONSTRAINT "email_message_labels_label_id_email_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."email_labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_thread_id_email_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."email_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_attachments_message_idx" ON "email_attachments" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_message_labels_unique" ON "email_message_labels" USING btree ("message_id","label_id");--> statement-breakpoint
CREATE INDEX "email_messages_thread_idx" ON "email_messages" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "email_messages_mailbox_folder_idx" ON "email_messages" USING btree ("mailbox_id","folder","created_at");--> statement-breakpoint
CREATE INDEX "email_threads_mailbox_idx" ON "email_threads" USING btree ("mailbox_id","last_message_at");
ALTER TABLE "messages" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "gmail_thread_id" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "gmail_message_id" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "reply_received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "last_polled_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "idx_messages_pending_reply" ON "messages" USING btree ("last_polled_at");
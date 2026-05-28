CREATE TYPE "public"."interaction_status" AS ENUM('sent', 'responded', 'no_answer', 'done');--> statement-breakpoint
ALTER TABLE "interactions" ADD COLUMN "status" "interaction_status";
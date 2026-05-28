CREATE TABLE "message_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"storage_bucket" text DEFAULT 'message-attachments' NOT NULL,
	"storage_path" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_message_attachments_message" ON "message_attachments" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "idx_message_attachments_org" ON "message_attachments" USING btree ("organization_id","uploaded_at");

-- ============================================================================
-- RLS — message_attachments (same 4-statement pattern as messages)
--   SELECT  : org members OR platform admin
--   INS/UPD : org members only
--   DELETE  : org members only
-- ============================================================================

ALTER TABLE message_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "message_attachments_select" ON message_attachments FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()) OR public.is_platform_admin());

CREATE POLICY "message_attachments_insert" ON message_attachments FOR INSERT
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()));

CREATE POLICY "message_attachments_update" ON message_attachments FOR UPDATE
  USING  (organization_id IN (SELECT public.user_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()));

CREATE POLICY "message_attachments_delete" ON message_attachments FOR DELETE
  USING (organization_id IN (SELECT public.user_organization_ids()));

-- ============================================================================
-- Supabase Storage bucket + policies for outbound message attachments.
--
-- Path layout: {organization_id}/{message_id}/{uuid}-{filename}
-- The first path segment is the org id, so we authorise reads/writes by
-- checking that segment against the caller's org membership. The bucket is
-- private — files are served via signed URLs only.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('message-attachments', 'message-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Read: org members of the path's first segment, or platform admins.
CREATE POLICY "message_attachments_storage_read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'message-attachments'
    AND (
      (storage.foldername(name))[1]::uuid IN (SELECT public.user_organization_ids())
      OR public.is_platform_admin()
    )
  );

-- Write: org members only.
CREATE POLICY "message_attachments_storage_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'message-attachments'
    AND (storage.foldername(name))[1]::uuid IN (SELECT public.user_organization_ids())
  );

-- Delete: org members only (used by the garbage-collect path when a Gmail
-- send fails after upload).
CREATE POLICY "message_attachments_storage_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'message-attachments'
    AND (storage.foldername(name))[1]::uuid IN (SELECT public.user_organization_ids())
  );
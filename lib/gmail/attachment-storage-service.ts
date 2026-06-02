import "server-only";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";

/**
 * Errors specific to attachment storage. The service throws these instead
 * of raw Error so the action layer can map them to user-facing codes
 * cleanly. Aligned with the codebase's typed-error-hierarchy convention.
 */
export abstract class AttachmentStorageError extends Error {
  abstract readonly code: string;
}

export class AttachmentUploadFailedError extends AttachmentStorageError {
  readonly code = "ATTACHMENT_UPLOAD_FAILED";
  constructor(message: string) {
    super(message);
  }
}

export class AttachmentSignedUrlFailedError extends AttachmentStorageError {
  readonly code = "ATTACHMENT_SIGNED_URL_FAILED";
  constructor(message: string) {
    super(message);
  }
}

const BUCKET = "message-attachments";

/** Default lifetime for download signed URLs (5 minutes — re-issue on demand). */
const DEFAULT_SIGNED_URL_TTL_SECONDS = 60 * 5;

export type UploadInput = {
  organizationId: string;
  messageId: string;
  filename: string;
  mimeType: string;
  content: Buffer;
};

/**
 * Sprint 12 — input for the step-scoped variant. Same bucket, different
 * path prefix (`step-<stepId>` instead of `<messageId>`) so storage RLS
 * (org id as first segment) stays consistent.
 */
export type UploadForStepInput = {
  organizationId: string;
  stepId: string;
  filename: string;
  mimeType: string;
  content: Buffer;
};

export type UploadResult = {
  storageBucket: string;
  storagePath: string;
};

/**
 * Single responsibility : push file bytes into the private Supabase Storage
 * bucket reserved for outbound attachments, hand back signed URLs for
 * download, and clean up when a send fails.
 *
 * Storage path layout : `{organization_id}/{message_id}/{uuid}-{filename}`.
 * The org id sits in the first path segment, which lines up with the
 * storage RLS policy (see the migration) so a user can only read/write
 * objects under their own org.
 *
 * Constructor takes no collaborators — it builds a Supabase client per
 * call site via the shared server helper. That keeps it testable (we can
 * mock the createClient import) without needing DI wiring for a single
 * dependency.
 */
export class AttachmentStorageService {
  /** Sanitises the original filename for the storage path. Keeps the
   *  original on the metadata row (DB column `filename`) for display ;
   *  this path-safe variant only needs to be unique enough not to collide
   *  with itself and not break URL encoding. */
  private buildStoragePath(input: UploadInput): string {
    const safeName = input.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
    return `${input.organizationId}/${input.messageId}/${randomUUID()}-${safeName}`;
  }

  public async upload(input: UploadInput): Promise<UploadResult> {
    const supabase = await createClient();
    const path = this.buildStoragePath(input);

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, input.content, {
        contentType: input.mimeType,
        upsert: false,
      });

    if (error) {
      throw new AttachmentUploadFailedError(
        `Could not upload ${input.filename} : ${error.message}`,
      );
    }

    return { storageBucket: BUCKET, storagePath: path };
  }

  /**
   * Sprint 12 — variant for sequence-step pre-attachments. Same bucket
   * + same RLS policy ; the only difference is the path namespace
   * (`step-<stepId>` instead of a message id) so cleanup hooks can
   * distinguish step files from message files when listing for a sequence.
   */
  public async uploadForStep(input: UploadForStepInput): Promise<UploadResult> {
    const supabase = await createClient();
    const safeName = input.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
    const path = `${input.organizationId}/step-${input.stepId}/${randomUUID()}-${safeName}`;

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, input.content, {
        contentType: input.mimeType,
        upsert: false,
      });

    if (error) {
      throw new AttachmentUploadFailedError(
        `Could not upload ${input.filename} : ${error.message}`,
      );
    }

    return { storageBucket: BUCKET, storagePath: path };
  }

  /**
   * Best-effort delete used by the garbage-collect path when Gmail send
   * fails after an upload has already landed in Storage. We deliberately
   * swallow errors here — the worst case is an orphaned file in a private
   * bucket, which is harmless compared to surfacing a misleading error to
   * the user.
   */
  public async deleteQuietly(bucket: string, path: string): Promise<void> {
    const supabase = await createClient();
    await supabase.storage.from(bucket).remove([path]).catch(() => undefined);
  }

  /**
   * Returns a short-lived signed URL for the attachment, used by the
   * "download" link on the message detail / interaction timeline. The
   * bucket is private, so we never expose direct object paths.
   */
  public async signedDownloadUrl(
    bucket: string,
    path: string,
    ttlSeconds: number = DEFAULT_SIGNED_URL_TTL_SECONDS,
  ): Promise<string> {
    const supabase = await createClient();
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, ttlSeconds);
    if (error || !data?.signedUrl) {
      throw new AttachmentSignedUrlFailedError(
        `Could not issue signed URL for ${path} : ${error?.message ?? "unknown"}`,
      );
    }
    return data.signedUrl;
  }

  /** Downloads the file bytes — used at send time to feed the MIME builder
   *  after a fresh upload (or by a future "resend with original attachment"
   *  flow). */
  public async download(bucket: string, path: string): Promise<Buffer> {
    const supabase = await createClient();
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error || !data) {
      throw new AttachmentUploadFailedError(
        `Could not download ${path} : ${error?.message ?? "unknown"}`,
      );
    }
    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}

/** Singleton factory — the service is stateless so we reuse one instance. */
let cached: AttachmentStorageService | null = null;
export function getAttachmentStorageService(): AttachmentStorageService {
  if (!cached) cached = new AttachmentStorageService();
  return cached;
}

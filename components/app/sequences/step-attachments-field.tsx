"use client";

import { useRef, useState } from "react";
import { Paperclip, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  uploadStepAttachmentAction,
  removeStepAttachmentAction,
} from "@/lib/actions/sequences";
import {
  MAX_STEP_ATTACHMENTS,
  MAX_STEP_ATTACHMENT_BYTES,
} from "@/lib/sequences/step-attachments";
import { ALLOWED_ATTACHMENT_MIME_TYPES } from "@/lib/gmail/attachment-limits";
import type { SequenceStepAttachmentRef } from "@/lib/sequences/types";

/**
 * Sprint 12 — step-level attachments UI for `defined`-mode email steps.
 *
 * Owns no draft state itself : it reads the current attachments from
 * the parent (the step detail panel) and emits a new array via
 * `onChange`. The parent threads that back into `actionConfig.attachments`
 * and lets the editor's auto-save persist it.
 *
 * Storage cleanup is asymmetric :
 *   - Add → server stores the file ; ref appended optimistically only
 *     after the action returns successfully.
 *   - Remove → optimistic ; server best-effort deletes the Storage
 *     object only if it isn't referenced by the published step set
 *     (otherwise the publish hook will clean it later).
 */
export function StepAttachmentsField({
  sequenceId,
  stepId,
  value,
  onChange,
}: {
  sequenceId: string;
  stepId: string;
  value: SequenceStepAttachmentRef[];
  onChange: (next: SequenceStepAttachmentRef[]) => void;
}) {
  const t = useTranslations("pages.sequences.editor.attachments");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handlePick = () => inputRef.current?.click();

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    // Single-file upload per pick (simpler; the user can repeat).
    const file = files.item(0);
    if (!file) return;
    setLocalError(null);

    // Client-side guard for size — saves a round-trip when the file is
    // obviously too big. The server enforces all caps regardless.
    if (file.size > MAX_STEP_ATTACHMENT_BYTES) {
      setLocalError(t("errors.tooLarge"));
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    if (value.length >= MAX_STEP_ATTACHMENTS) {
      setLocalError(t("errors.tooMany"));
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    const fd = new FormData();
    fd.set("sequenceId", sequenceId);
    fd.set("stepId", stepId);
    fd.set("existing", JSON.stringify(value));
    fd.set("file", file);

    setBusy(true);
    try {
      const ref = await uploadStepAttachmentAction(fd);
      if (ref) onChange([...value, ref]);
    } catch (err) {
      // `withActionError` will normally redirect through the action error
      // modal for user-facing failures. This catch handles network / SSR
      // edge cases ; surface a generic message inline.
      console.error("[StepAttachmentsField] upload failed", err);
      setLocalError(t("errors.uploadFailed"));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleRemove = async (storagePath: string) => {
    // Optimistic local removal — even if the server-side cleanup is a
    // best-effort no-op (the file is still referenced by the published
    // version), the draft no longer references it.
    onChange(value.filter((a) => a.storagePath !== storagePath));
    const fd = new FormData();
    fd.set("sequenceId", sequenceId);
    fd.set("storagePath", storagePath);
    try {
      await removeStepAttachmentAction(fd);
    } catch (err) {
      // Storage may still hold the orphan ; that's recoverable but
      // shouldn't block the user. Log only.
      console.error("[StepAttachmentsField] remove failed", err);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{t("label")}</span>
        <span className="text-xs text-muted-foreground">
          {value.length} / {MAX_STEP_ATTACHMENTS}
        </span>
      </div>

      {value.length > 0 && (
        <ul className="space-y-1">
          {value.map((a) => (
            <li
              key={a.storagePath}
              className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1 text-xs"
            >
              <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate" title={a.filename}>
                {a.filename}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {formatBytes(a.sizeBytes)}
              </span>
              <button
                type="button"
                onClick={() => handleRemove(a.storagePath)}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                aria-label={t("remove")}
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handlePick}
          disabled={busy || value.length >= MAX_STEP_ATTACHMENTS}
        >
          <Paperclip className="size-3.5" />
          {busy ? t("uploading") : t("add")}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED_ATTACHMENT_MIME_TYPES.join(",")}
          className="hidden"
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </div>

      <p className="text-xs text-muted-foreground">{t("help")}</p>
      {localError && (
        <p className="text-xs text-destructive">{localError}</p>
      )}
    </div>
  );
}

/** Local pretty-printer — kept inline so the field has no extra deps. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

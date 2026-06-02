/**
 * Sprint 12 — Pure helpers for sequence-step attachments.
 *
 * Centralises the small business logic that runs around upload / remove
 * / publish / discard so the action layer stays thin and the rules
 * (limits, diffing for cleanup) are unit-testable without a DB or
 * Storage mock.
 */

import type { SequenceStepAttachmentRef } from "./types";
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
  isAllowedAttachmentMimeType,
} from "@/lib/gmail/attachment-limits";

/**
 * Step attachments share the same limits as the message-send pipeline
 * (`lib/gmail/attachment-limits.ts`) — a file uploaded on a step is just
 * a file that'll travel through Gmail later, so any divergence here
 * would surface as "you uploaded this on the step, we can't actually
 * send it" weeks later. Single source of truth wins.
 */
export const MAX_STEP_ATTACHMENTS = MAX_ATTACHMENTS_PER_MESSAGE;
export const MAX_STEP_ATTACHMENT_BYTES = MAX_ATTACHMENT_BYTES;
export const MAX_STEP_ATTACHMENTS_TOTAL_BYTES = MAX_TOTAL_ATTACHMENT_BYTES;

/** Re-exported under the step-attachment name for ergonomic imports. */
export const STEP_ATTACHMENT_ALLOWED_MIME = new Set<string>(
  ALLOWED_ATTACHMENT_MIME_TYPES,
);

export function isAllowedStepAttachmentMime(mime: string): boolean {
  return isAllowedAttachmentMimeType(mime);
}

/**
 * Compute the set of storage paths that disappear between an old list
 * and a new list of attachment refs. Used by the discard / publish
 * cleanup hooks to find orphans to remove from Storage.
 *
 * Pure : same input → same output. Order-independent.
 */
export function diffRemovedAttachmentPaths(
  oldList: readonly SequenceStepAttachmentRef[] | null | undefined,
  newList: readonly SequenceStepAttachmentRef[] | null | undefined,
): string[] {
  if (!oldList || oldList.length === 0) return [];
  const next = new Set((newList ?? []).map((a) => a.storagePath));
  const removed: string[] = [];
  for (const a of oldList) {
    if (!next.has(a.storagePath)) removed.push(a.storagePath);
  }
  return removed;
}

/**
 * Collects every attachment storagePath referenced by a draft (or a
 * published step set). Used by the discard / publish cleanup hooks to
 * compute the set of orphan files to remove.
 *
 * Accepts a loose shape so it works on both shapes — DraftDefinition
 * (steps[].actionConfig.attachments) and published rows
 * (PublishStepRow[]). Anything that doesn't look like an attachment
 * array is silently skipped.
 */
export function collectAttachmentPathsFromSteps(
  steps: ReadonlyArray<{ actionConfig?: unknown } | null | undefined>,
): string[] {
  const paths: string[] = [];
  for (const step of steps) {
    const cfg = (step?.actionConfig ?? {}) as { attachments?: unknown };
    if (!Array.isArray(cfg.attachments)) continue;
    for (const a of cfg.attachments) {
      if (a && typeof a === "object" && typeof (a as { storagePath?: unknown }).storagePath === "string") {
        paths.push((a as { storagePath: string }).storagePath);
      }
    }
  }
  return paths;
}

/**
 * Aggregate validation : checks `MAX_STEP_ATTACHMENTS`, per-file size,
 * and total bytes when adding `incoming` to an `existing` list. Returns
 * the first violation code or null if everything fits.
 *
 * Codes line up with the i18n keys under `actionErrors.*` so the
 * action wrapper can surface a clear modal.
 */
export type StepAttachmentValidationCode =
  | "step_attachment_too_many"
  | "step_attachment_too_large"
  | "step_attachments_total_too_large"
  | "step_attachment_bad_mime";

export function validateNewStepAttachment(args: {
  existing: readonly SequenceStepAttachmentRef[];
  incoming: { mimeType: string; sizeBytes: number };
}): StepAttachmentValidationCode | null {
  if (args.existing.length >= MAX_STEP_ATTACHMENTS) {
    return "step_attachment_too_many";
  }
  if (args.incoming.sizeBytes > MAX_STEP_ATTACHMENT_BYTES) {
    return "step_attachment_too_large";
  }
  const total =
    args.existing.reduce((sum, a) => sum + a.sizeBytes, 0) +
    args.incoming.sizeBytes;
  if (total > MAX_STEP_ATTACHMENTS_TOTAL_BYTES) {
    return "step_attachments_total_too_large";
  }
  if (!isAllowedStepAttachmentMime(args.incoming.mimeType)) {
    return "step_attachment_bad_mime";
  }
  return null;
}

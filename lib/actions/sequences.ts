"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { getActiveOrg } from "@/lib/auth/context";
import { getDb } from "@/db/client";
import { contacts } from "@/db/schema";
import { withActionError, wrapActionError } from "./wrap-action-error";
import {
  InvalidInputError,
  SequenceNotFoundError,
  SequenceLockedError,
  EnrolmentNotFoundError,
  ContactNotEligibleError,
  StepAttachmentRejectedError,
} from "./sequence-action-errors";
import { SequenceEditingServiceFactory } from "@/lib/sequences/sequence-editing-service-factory";
import { SequenceEnrolmentService } from "@/lib/sequences/sequence-enrolment-service";
import { getBuiltInTemplate } from "@/lib/sequences/built-in-templates";
import {
  insertSequence,
  getSequenceById,
  getStepsForSequence,
  setSequenceActive,
  softDeleteSequence,
  updateSequenceMeta,
} from "@/db/queries/sequences";
import {
  collectAttachmentPathsFromSteps,
  validateNewStepAttachment,
} from "@/lib/sequences/step-attachments";
import { getAttachmentStorageService } from "@/lib/gmail/attachment-storage-service";
import type { SequenceStepAttachmentRef } from "@/lib/sequences/types";

/**
 * Same bucket as message attachments — shared RLS policy ; the path
 * namespace (`<orgId>/step-<stepId>/...`) keeps step pre-attachments
 * separate from message-bound uploads.
 */
const STEP_ATTACHMENT_BUCKET_NAME = "message-attachments";

/**
 * Mirrors `SequenceEditingService.assertLockAvailable` — the upload
 * action lives outside the service (it doesn't follow the draft-save
 * shape), so we re-implement the rule inline rather than leak service
 * internals. TTL matches the service's 30-minute lock window.
 */
const LOCK_TTL_MS = 30 * 60_000;
function assertEditingLockAvailable(
  lockedBy: string | null,
  lockedAt: Date | null,
  userId: string,
): void {
  if (!lockedBy || lockedBy === userId) return;
  const fresh = lockedAt != null && Date.now() - lockedAt.getTime() < LOCK_TTL_MS;
  if (fresh) {
    throw new SequenceLockedError(lockedBy);
  }
}
import {
  getEnrolmentById,
  setEnrolmentStatus,
  endEnrolment,
} from "@/db/queries/sequence-enrolments";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function revalidateSequence(id?: string) {
  revalidatePath("/sequences");
  if (id) revalidatePath(`/sequences/${id}`);
}

// ---------------------------------------------------------------------------
// Create / meta / lifecycle
// ---------------------------------------------------------------------------

const createSchema = z.object({
  name: z.string().min(1).max(120).optional().or(z.literal("")),
  description: z.string().max(500).optional().or(z.literal("")),
  /** Optional : clone a built-in template into the new sequence's draft. */
  templateSlug: z.string().max(80).optional().or(z.literal("")),
});

async function _createSequenceAction(formData: FormData) {
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new InvalidInputError(parsed.error);
  const { activeOrganization } = await getActiveOrg();
  const locale = activeOrganization.defaultLocale === "en" ? "en" : "fr";

  const template = parsed.data.templateSlug
    ? getBuiltInTemplate(parsed.data.templateSlug)
    : undefined;
  if (parsed.data.templateSlug && !template) {
    throw new InvalidInputError();
  }

  // Name precedence : explicit input → template name (org locale) → fallback.
  const name =
    parsed.data.name ||
    (template ? template.name[locale] : "") ||
    "Nouvelle séquence";
  const description =
    parsed.data.description || (template ? template.description[locale] : null);

  const row = await insertSequence(getDb(), activeOrganization.id, {
    name,
    description,
    // New sequences start as unpublished drafts. A template seeds the draft
    // graph (cloned, not referenced) so the editor opens pre-filled ; a blank
    // sequence has no steps until the user publishes.
    isActive: false,
    draftDefinition: template ? template.draft : undefined,
    targetRelationshipTypes: template?.targeting?.targetRelationshipTypes,
    targetSiteTypes: template?.targeting?.targetSiteTypes,
    targetContactRoles: template?.targeting?.targetContactRoles,
  });

  revalidateSequence(row.id);
  return { sequenceId: row.id };
}
export const createSequenceAction = withActionError(_createSequenceAction);

/**
 * Same as `createSequenceAction` but navigates to the new sequence's editor on
 * success (used by the "New sequence" form). Redirect lives outside the
 * try-body so Next's control-flow throw isn't caught as an action error.
 */
async function _createSequenceAndOpenAction(formData: FormData) {
  const result = await _createSequenceAction(formData);
  return result?.sequenceId ?? null;
}
export async function createSequenceAndOpenAction(formData: FormData) {
  const sequenceId = await wrapActionError(() => _createSequenceAndOpenAction(formData));
  if (sequenceId) redirect(`/sequences/${sequenceId}/edit`);
}

const metaSchema = z.object({
  sequenceId: z.string().uuid(),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().or(z.literal("")),
});

async function _updateSequenceMetaAction(formData: FormData) {
  const parsed = metaSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new InvalidInputError(parsed.error);
  const { activeOrganization } = await getActiveOrg();

  const existing = await getSequenceById(getDb(), activeOrganization.id, parsed.data.sequenceId);
  if (!existing) throw new SequenceNotFoundError(parsed.data.sequenceId);

  await updateSequenceMeta(getDb(), activeOrganization.id, parsed.data.sequenceId, {
    name: parsed.data.name,
    description: parsed.data.description || null,
  });
  revalidateSequence(parsed.data.sequenceId);
}
export const updateSequenceMetaAction = withActionError(_updateSequenceMetaAction);

/**
 * Slice D — sequence-level "what to do when reply outcome is unknown".
 * The literal union mirrors the DB CHECK constraint + the runtime SoT
 * in `lib/sequences/unknown-outcome-strategy.ts`.
 */
const unknownOutcomeStrategySchema = z.object({
  sequenceId: z.string().uuid(),
  strategy: z.enum(["park", "continue_default"]),
});

async function _updateSequenceUnknownOutcomeStrategyAction(formData: FormData) {
  const parsed = unknownOutcomeStrategySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new InvalidInputError(parsed.error);
  const { activeOrganization } = await getActiveOrg();

  const existing = await getSequenceById(getDb(), activeOrganization.id, parsed.data.sequenceId);
  if (!existing) throw new SequenceNotFoundError(parsed.data.sequenceId);

  await updateSequenceMeta(getDb(), activeOrganization.id, parsed.data.sequenceId, {
    unknownOutcomeStrategy: parsed.data.strategy,
  });
  revalidateSequence(parsed.data.sequenceId);
}
export const updateSequenceUnknownOutcomeStrategyAction = withActionError(
  _updateSequenceUnknownOutcomeStrategyAction,
);

/**
 * Sprint 12 — sequence-level "AI message context scope" config. Drives
 * what slice of interaction history the generator pulls into the prompt
 * when generating a message for a task that comes from this sequence.
 * Per-step override lives on `sequence_steps.message_context_scope` ;
 * the dialog at generation time can also override per-message.
 */
const messageContextScopeSchema = z.object({
  sequenceId: z.string().uuid(),
  scope: z.enum(["sequence", "all"]),
});

async function _updateSequenceMessageContextScopeAction(formData: FormData) {
  const parsed = messageContextScopeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new InvalidInputError(parsed.error);
  const { activeOrganization } = await getActiveOrg();

  const existing = await getSequenceById(getDb(), activeOrganization.id, parsed.data.sequenceId);
  if (!existing) throw new SequenceNotFoundError(parsed.data.sequenceId);

  await updateSequenceMeta(getDb(), activeOrganization.id, parsed.data.sequenceId, {
    messageContextScope: parsed.data.scope,
  });
  revalidateSequence(parsed.data.sequenceId);
}
export const updateSequenceMessageContextScopeAction = withActionError(
  _updateSequenceMessageContextScopeAction,
);

const activeSchema = z.object({
  sequenceId: z.string().uuid(),
  isActive: z.preprocess((v) => v === "true" || v === true || v === "on" || v === "1", z.boolean()),
});

async function _setSequenceActiveAction(formData: FormData) {
  const parsed = activeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new InvalidInputError(parsed.error);
  const { activeOrganization } = await getActiveOrg();

  const existing = await getSequenceById(getDb(), activeOrganization.id, parsed.data.sequenceId);
  if (!existing) throw new SequenceNotFoundError(parsed.data.sequenceId);

  await setSequenceActive(getDb(), activeOrganization.id, parsed.data.sequenceId, parsed.data.isActive);
  revalidateSequence(parsed.data.sequenceId);
}
export const setSequenceActiveAction = withActionError(_setSequenceActiveAction);

const deleteSchema = z.object({ sequenceId: z.string().uuid() });

async function _deleteSequenceAction(formData: FormData) {
  const parsed = deleteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new InvalidInputError(parsed.error);
  const { activeOrganization } = await getActiveOrg();

  const existing = await getSequenceById(getDb(), activeOrganization.id, parsed.data.sequenceId);
  if (!existing) throw new SequenceNotFoundError(parsed.data.sequenceId);

  await softDeleteSequence(getDb(), activeOrganization.id, parsed.data.sequenceId);
  revalidatePath("/sequences");
}
export const deleteSequenceAction = withActionError(_deleteSequenceAction);

// ---------------------------------------------------------------------------
// Editing : lock / draft / publish (delegates to SequenceEditingService)
// ---------------------------------------------------------------------------

const sequenceIdSchema = z.object({ sequenceId: z.string().uuid() });

async function _startEditingAction(formData: FormData) {
  const parsed = sequenceIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new InvalidInputError(parsed.error);
  const { activeOrganization, user } = await getActiveOrg();

  await SequenceEditingServiceFactory.getInstance().startEditing(
    activeOrganization.id,
    parsed.data.sequenceId,
    user.id,
  );
  revalidateSequence(parsed.data.sequenceId);
}
export const startEditingAction = withActionError(_startEditingAction);

async function _releaseLockAction(formData: FormData) {
  const parsed = sequenceIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new InvalidInputError(parsed.error);
  const { activeOrganization, user } = await getActiveOrg();

  await SequenceEditingServiceFactory.getInstance().releaseLock(
    activeOrganization.id,
    parsed.data.sequenceId,
    user.id,
  );
  revalidateSequence(parsed.data.sequenceId);
}
export const releaseLockAction = withActionError(_releaseLockAction);

const saveDraftSchema = z.object({
  sequenceId: z.string().uuid(),
  draft: z.string().min(2), // JSON-encoded DraftDefinition
});

async function _saveDraftAction(formData: FormData) {
  const parsed = saveDraftSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new InvalidInputError(parsed.error);
  const { activeOrganization, user } = await getActiveOrg();

  let draft: unknown;
  try {
    draft = JSON.parse(parsed.data.draft);
  } catch {
    throw new InvalidInputError();
  }

  await SequenceEditingServiceFactory.getInstance().saveDraft(
    activeOrganization.id,
    parsed.data.sequenceId,
    user.id,
    draft,
  );
  revalidateSequence(parsed.data.sequenceId);
}
export const saveDraftAction = withActionError(_saveDraftAction);

async function _publishSequenceAction(formData: FormData) {
  const parsed = sequenceIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new InvalidInputError(parsed.error);
  const { activeOrganization, user } = await getActiveOrg();

  const result = await SequenceEditingServiceFactory.getInstance().publishDraft(
    activeOrganization.id,
    parsed.data.sequenceId,
    user.id,
  );
  // A published sequence with steps becomes runnable.
  await setSequenceActive(getDb(), activeOrganization.id, parsed.data.sequenceId, true);
  revalidateSequence(parsed.data.sequenceId);
  return result;
}
export const publishSequenceAction = withActionError(_publishSequenceAction);

async function _discardDraftAction(formData: FormData) {
  const parsed = sequenceIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new InvalidInputError(parsed.error);
  const { activeOrganization, user } = await getActiveOrg();

  await SequenceEditingServiceFactory.getInstance().discardDraft(
    activeOrganization.id,
    parsed.data.sequenceId,
    user.id,
  );
  revalidateSequence(parsed.data.sequenceId);
}
export const discardDraftAction = withActionError(_discardDraftAction);

// ---------------------------------------------------------------------------
// Enrolment
// ---------------------------------------------------------------------------

const enrollSchema = z.object({
  sequenceId: z.string().uuid(),
  contactId: z.string().uuid(),
  companyId: z.string().uuid(),
  assigneeId: z.string().uuid().optional().or(z.literal("")),
});

async function _enrollContactAction(formData: FormData) {
  const parsed = enrollSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new InvalidInputError(parsed.error);
  const { activeOrganization, user } = await getActiveOrg();

  const service = new SequenceEnrolmentService({ db: getDb() });
  const result = await service.enrollContact(activeOrganization.id, {
    sequenceId: parsed.data.sequenceId,
    contactId: parsed.data.contactId,
    companyId: parsed.data.companyId,
    assigneeId: parsed.data.assigneeId || user.id,
  });

  if (!result.ok) {
    throw new ContactNotEligibleError(result.reason);
  }

  revalidatePath(`/contacts/${parsed.data.contactId}`);
  revalidateSequence(parsed.data.sequenceId);
  return { enrolmentId: result.enrolmentId };
}
export const enrollContactAction = withActionError(_enrollContactAction);

// ---------------------------------------------------------------------------
// Bulk enroll : called from the contacts list page with a list of selected
// contact ids. Loads each contact's companyId (we don't trust the client to
// supply it), runs `enrollContact` per row in parallel, and aggregates the
// outcome into URL params so the contacts page can flash a banner. Per-row
// failures (already enrolled, opted out, cooldown, etc.) don't fail the
// whole call — they're counted in `skipped`. RLS + multi-tenant filtering
// makes the loaded-contacts set safe : a contactId outside the active org
// would never come back.
// ---------------------------------------------------------------------------

const bulkEnrollSchema = z.object({
  sequenceId: z.string().uuid(),
  // contactIds arrive as a JSON-stringified array in a hidden input. We cap
  // at 500 to match the page-size limit on `listContactsByOrg`.
  contactIds: z.array(z.string().uuid()).min(1).max(500),
});

async function _bulkEnrollContactsAction(formData: FormData) {
  const rawIds = formData.get("contactIds");
  let parsedIds: unknown = [];
  if (typeof rawIds === "string" && rawIds.length > 0) {
    try {
      parsedIds = JSON.parse(rawIds);
    } catch {
      throw new InvalidInputError();
    }
  }

  const parsed = bulkEnrollSchema.safeParse({
    sequenceId: formData.get("sequenceId"),
    contactIds: parsedIds,
  });
  if (!parsed.success) throw new InvalidInputError(parsed.error);

  const { activeOrganization, user } = await getActiveOrg();

  // Load the trusted (orgId, contactId, companyId) tuples — drops any ids
  // not in this org or already soft-deleted before we hit the service.
  const rows = await getDb()
    .select({ id: contacts.id, companyId: contacts.companyId })
    .from(contacts)
    .where(
      and(
        eq(contacts.organizationId, activeOrganization.id),
        inArray(contacts.id, parsed.data.contactIds),
        isNull(contacts.deletedAt),
      ),
    );

  const service = new SequenceEnrolmentService({ db: getDb() });
  const settled = await Promise.allSettled(
    rows.map((c) =>
      service.enrollContact(activeOrganization.id, {
        sequenceId: parsed.data.sequenceId,
        contactId: c.id,
        companyId: c.companyId,
        assigneeId: user.id,
      }),
    ),
  );

  let enrolled = 0;
  let skipped = 0;
  for (const r of settled) {
    if (r.status === "fulfilled" && r.value.ok) enrolled++;
    else skipped++;
  }

  revalidatePath("/contacts");
  revalidateSequence(parsed.data.sequenceId);
  redirect(`/contacts?bulk_enrolled=${enrolled}&bulk_skipped=${skipped}`);
}

export const bulkEnrollContactsAction = withActionError(_bulkEnrollContactsAction);

const enrolmentIdSchema = z.object({
  enrolmentId: z.string().uuid(),
  contactId: z.string().uuid().optional().or(z.literal("")),
});

async function loadEnrolmentOrThrow(orgId: string, enrolmentId: string) {
  const enrolment = await getEnrolmentById(getDb(), orgId, enrolmentId);
  if (!enrolment) throw new EnrolmentNotFoundError(enrolmentId);
  return enrolment;
}

async function _pauseEnrolmentAction(formData: FormData) {
  const parsed = enrolmentIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new InvalidInputError(parsed.error);
  const { activeOrganization } = await getActiveOrg();
  await loadEnrolmentOrThrow(activeOrganization.id, parsed.data.enrolmentId);

  await setEnrolmentStatus(getDb(), activeOrganization.id, parsed.data.enrolmentId, "paused");
  if (parsed.data.contactId) revalidatePath(`/contacts/${parsed.data.contactId}`);
}
export const pauseEnrolmentAction = withActionError(_pauseEnrolmentAction);

async function _resumeEnrolmentAction(formData: FormData) {
  const parsed = enrolmentIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new InvalidInputError(parsed.error);
  const { activeOrganization } = await getActiveOrg();
  await loadEnrolmentOrThrow(activeOrganization.id, parsed.data.enrolmentId);

  await setEnrolmentStatus(getDb(), activeOrganization.id, parsed.data.enrolmentId, "active");
  if (parsed.data.contactId) revalidatePath(`/contacts/${parsed.data.contactId}`);
}
export const resumeEnrolmentAction = withActionError(_resumeEnrolmentAction);

async function _stopEnrolmentAction(formData: FormData) {
  const parsed = enrolmentIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new InvalidInputError(parsed.error);
  const { activeOrganization } = await getActiveOrg();
  await loadEnrolmentOrThrow(activeOrganization.id, parsed.data.enrolmentId);

  await endEnrolment(getDb(), parsed.data.enrolmentId, "manual", new Date());
  if (parsed.data.contactId) revalidatePath(`/contacts/${parsed.data.contactId}`);
}
export const stopEnrolmentAction = withActionError(_stopEnrolmentAction);

// ---------------------------------------------------------------------------
// Sprint 12 — Step attachments
// ---------------------------------------------------------------------------

const uploadStepAttachmentSchema = z.object({
  sequenceId: z.string().uuid(),
  stepId: z.string().min(1),
});

/**
 * Uploads a single file to Storage scoped under the step. Returns the
 * attachment ref the client merges into the draft (then auto-save
 * persists the next draft snapshot). The client receives the ref via
 * the action return value — `withActionError` preserves it on success.
 *
 * Validation : file size + MIME + per-step caps (see
 * `validateNewStepAttachment`). The step's existing attachments must
 * be POSTed alongside (encoded JSON) so the action can enforce the
 * total-bytes cap without trusting a snapshot it doesn't own.
 */
async function _uploadStepAttachmentAction(
  formData: FormData,
): Promise<SequenceStepAttachmentRef> {
  const parsed = uploadStepAttachmentSchema.safeParse({
    sequenceId: formData.get("sequenceId"),
    stepId: formData.get("stepId"),
  });
  if (!parsed.success) throw new InvalidInputError(parsed.error);

  const file = formData.get("file");
  if (!(file instanceof File)) throw new InvalidInputError();

  const { activeOrganization, user } = await getActiveOrg();
  const seq = await getSequenceById(getDb(), activeOrganization.id, parsed.data.sequenceId);
  if (!seq) throw new SequenceNotFoundError(parsed.data.sequenceId);
  // Lock check : we're effectively editing the draft. Reuse the same
  // contract as saveDraft / publish (stale lock is OK to override).
  assertEditingLockAvailable(seq.editingLockedBy, seq.editingLockedAt, user.id);

  // Read the "existing" list from the form — the client passes the
  // current draft's step attachments so we can enforce the aggregate
  // caps. If absent, treat as empty (first upload).
  const existingRaw = formData.get("existing");
  let existing: SequenceStepAttachmentRef[] = [];
  if (typeof existingRaw === "string" && existingRaw.length > 0) {
    try {
      const parsedExisting = JSON.parse(existingRaw);
      if (Array.isArray(parsedExisting)) {
        existing = parsedExisting.filter(
          (a): a is SequenceStepAttachmentRef =>
            a &&
            typeof a === "object" &&
            typeof a.storagePath === "string" &&
            typeof a.filename === "string" &&
            typeof a.mimeType === "string" &&
            typeof a.sizeBytes === "number",
        );
      }
    } catch {
      // Bad client payload — treat as empty, the caps will still hold.
    }
  }

  const validation = validateNewStepAttachment({
    existing,
    incoming: { mimeType: file.type, sizeBytes: file.size },
  });
  if (validation) {
    throw new StepAttachmentRejectedError(validation);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const { storagePath } = await getAttachmentStorageService().uploadForStep({
    organizationId: activeOrganization.id,
    stepId: parsed.data.stepId,
    filename: file.name,
    mimeType: file.type,
    content: buffer,
  });

  return {
    storagePath,
    filename: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
  };
}
export const uploadStepAttachmentAction = withActionError(_uploadStepAttachmentAction);

const removeStepAttachmentSchema = z.object({
  sequenceId: z.string().uuid(),
  storagePath: z.string().min(1),
});

/**
 * Removes a step attachment from Storage if (and only if) the path is
 * not referenced by the currently published step set of the sequence.
 *
 * Two scenarios :
 *   - File was uploaded into the draft but never published → orphan,
 *     safe to delete from Storage immediately.
 *   - File is already in production → the user's "remove" only takes it
 *     out of the draft ; the published version still serves it to
 *     existing tasks. We leave it in Storage ; the eventual `publish`
 *     hook will clean it when the new version commits.
 *
 * The client patches its draft locally + saves regardless — this action
 * just decides whether the Storage object can go now.
 */
async function _removeStepAttachmentAction(formData: FormData): Promise<void> {
  const parsed = removeStepAttachmentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new InvalidInputError(parsed.error);
  const { activeOrganization } = await getActiveOrg();

  const seq = await getSequenceById(getDb(), activeOrganization.id, parsed.data.sequenceId);
  if (!seq) throw new SequenceNotFoundError(parsed.data.sequenceId);

  const publishedSteps = await getStepsForSequence(getDb(), parsed.data.sequenceId);
  const publishedPaths = new Set(collectAttachmentPathsFromSteps(publishedSteps));

  if (!publishedPaths.has(parsed.data.storagePath)) {
    // Safe to delete from Storage now — no one is serving it.
    await getAttachmentStorageService()
      .deleteQuietly(STEP_ATTACHMENT_BUCKET_NAME, parsed.data.storagePath)
      .catch((err) => {
        console.error("[uploadStepAttachmentAction] delete failed", err);
      });
  }
}
export const removeStepAttachmentAction = withActionError(_removeStepAttachmentAction);

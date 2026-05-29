"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getActiveOrg } from "@/lib/auth/context";
import { getDb } from "@/db/client";
import { withActionError, wrapActionError } from "./wrap-action-error";
import {
  InvalidInputError,
  SequenceNotFoundError,
  EnrolmentNotFoundError,
  ContactNotEligibleError,
} from "./sequence-action-errors";
import { SequenceEditingServiceFactory } from "@/lib/sequences/sequence-editing-service-factory";
import { SequenceEnrolmentService } from "@/lib/sequences/sequence-enrolment-service";
import { getBuiltInTemplate } from "@/lib/sequences/built-in-templates";
import {
  insertSequence,
  getSequenceById,
  setSequenceActive,
  softDeleteSequence,
  updateSequenceMeta,
} from "@/db/queries/sequences";
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

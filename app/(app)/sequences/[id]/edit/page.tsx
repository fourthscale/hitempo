import { notFound } from "next/navigation";
import { getActiveOrg } from "@/lib/auth/context";
import { getDb } from "@/db/client";
import {
  getSequenceWithSteps,
  getActiveSequencesForTargeting,
} from "@/db/queries/sequences";
import { getOrgMembersWithNames } from "@/db/queries/members";
import { draftDefinitionSchema, type DraftDefinition } from "@/lib/sequences/draft-schema";
import { publishedStepsToDraft } from "@/lib/sequences/draft-from-steps";
import { SequenceEditor } from "@/components/app/sequences/sequence-editor";

const LOCK_TTL_MS = 30 * 60_000;

export default async function SequenceEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { activeOrganization, user } = await getActiveOrg();
  const data = await getSequenceWithSteps(getDb(), activeOrganization.id, id);
  if (!data) notFound();

  // Initial draft : pending draft if present (validated), else seed from the
  // published steps so the editor always opens on a real graph.
  const parsedDraft = data.sequence.draftDefinition
    ? draftDefinitionSchema.safeParse(data.sequence.draftDefinition)
    : null;
  const initialDraft: DraftDefinition = parsedDraft?.success
    ? parsedDraft.data
    : publishedStepsToDraft(data.steps);

  // Lock state : another user holds a fresh lock → render read-only.
  const lockedBy = data.sequence.editingLockedBy;
  const lockedAt = data.sequence.editingLockedAt;
  // eslint-disable-next-line react-hooks/purity -- server component, renders once per request
  const now = Date.now();
  const lockedByOther =
    lockedBy != null &&
    lockedBy !== user.id &&
    lockedAt != null &&
    now - lockedAt.getTime() < LOCK_TTL_MS;

  const others = await getActiveSequencesForTargeting(getDb(), activeOrganization.id);
  const otherSequences = others
    .filter((s) => s.id !== id)
    .map((s) => ({ id: s.id, name: s.name }));

  const orgMembers = (await getOrgMembersWithNames(activeOrganization.id)).map((m) => ({
    id: m.userId,
    name: m.displayName,
  }));

  // Trigger summary : targeting axes that are restricted (raw data values).
  const triggerSummaryParts = [
    ...data.sequence.targetRelationshipTypes,
    ...data.sequence.targetSiteTypes,
    ...data.sequence.targetContactRoles,
  ];

  return (
    <div className="max-w-[1400px] mx-auto">
      <SequenceEditor
        sequenceId={id}
        initialDraft={initialDraft}
        // A pending draft exists iff the DB has stored a draft_definition
        // we successfully parsed. A seed built from the published steps
        // (parsedDraft null/failure) is NOT a pending draft — Publish /
        // Discard would have nothing to do.
        initialHasPendingDraft={Boolean(parsedDraft?.success)}
        otherSequences={otherSequences}
        orgMembers={orgMembers}
        orgLocale={activeOrganization.defaultLocale}
        lockedByOther={lockedByOther}
        triggerSummary={triggerSummaryParts.join(" · ")}
      />
    </div>
  );
}

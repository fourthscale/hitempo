"use client";

import "@xyflow/react/dist/style.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ReactFlow, Background, Controls } from "@xyflow/react";
import { useAnchorTopViewport } from "./anchor-top-viewport";
import {
  Mail,
  Phone,
  Send,
  Clock,
  GitBranch,
  Split,
  UserCog,
  Workflow,
  GitMerge,
  ArrowLeft,
  Loader2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DraftDefinition, DraftStep } from "@/lib/sequences/draft-schema";
import type { SequenceStepActionType, NextStepIds } from "@/lib/sequences/types";
import { SEQUENCE_PALETTE_GROUPS, SEQUENCE_COMING_SOON } from "@/lib/sequences/types";
import { emptyGroup } from "@/lib/sequences/conditions";
import {
  gcUnreachableSteps,
  repointRefs,
  deleteStepKeepingPath,
  moveStep,
  joinBranches,
  unmergeStep,
} from "@/lib/sequences/draft-edit";
import { SequenceStepNode } from "./sequence-step-node";
import { SequenceStepDetailPanel } from "./sequence-step-detail-panel";
import { buildSequenceGraph } from "./build-sequence-graph";
import {
  SequenceFlowContext,
  SequenceInsertEdge,
  TriggerNode,
  TerminalNode,
  MergeNode,
} from "./sequence-flow-bits";
import { useSequenceLayout } from "./use-sequence-layout";
import {
  saveDraftAction,
  publishSequenceAction,
  discardDraftAction,
  startEditingAction,
  releaseLockAction,
} from "@/lib/actions/sequences";

const nodeTypes = {
  sequenceStep: SequenceStepNode,
  trigger: TriggerNode,
  terminal: TerminalNode,
  merge: MergeNode,
};
const edgeTypes = { insertable: SequenceInsertEdge };

const TRIGGER_ID = "__trigger";

const ICONS: Record<SequenceStepActionType, typeof Mail> = {
  send_email: Mail,
  send_linkedin: Send,
  phone_call: Phone,
  update_contact: UserCog,
  wait_delay: Clock,
  conditional_split: GitBranch,
  conditional_switch: Split,
  enroll_in_sequence: Workflow,
  merge: GitMerge,
};

type SaveState = "idle" | "saving" | "saved" | "error";

function defaultConfig(type: SequenceStepActionType): DraftStep["actionConfig"] {
  switch (type) {
    case "send_email":
      return { mode: "ai", channel: "email", intent: "first_contact", titleTemplate: { fr: "", en: "" } };
    case "send_linkedin":
      return { mode: "ai", channel: "linkedin", intent: "first_contact", titleTemplate: { fr: "", en: "" } };
    case "phone_call":
      return { titleTemplate: { fr: "", en: "" } };
    case "update_contact":
      return {};
    case "wait_delay":
      return { durationValue: 3, durationUnit: "days" };
    case "conditional_split":
      return { condition: emptyGroup() };
    case "conditional_switch":
      return { branches: [{ condition: emptyGroup() }] };
    case "enroll_in_sequence":
      return { targetSequenceId: "" };
    case "merge":
      // Created via join, never from the palette ; included for exhaustiveness.
      return {};
  }
}


export function SequenceEditor({
  sequenceId,
  initialDraft,
  initialHasPendingDraft,
  otherSequences,
  orgMembers,
  orgLocale,
  lockedByOther,
  triggerSummary,
}: {
  sequenceId: string;
  initialDraft: DraftDefinition;
  /**
   * True when the sequence currently has a `draftDefinition` row pending
   * publish (i.e. some edits have been saved but not committed yet).
   * Drives whether the Publish / Discard buttons are actionable —
   * showing them when there's nothing to publish was misleading.
   */
  initialHasPendingDraft: boolean;
  otherSequences: { id: string; name: string }[];
  orgMembers: { id: string; name: string }[];
  orgLocale: string;
  lockedByOther: boolean;
  triggerSummary: string;
}) {
  const t = useTranslations("pages.sequences");
  const router = useRouter();
  const [draft, setDraft] = useState<DraftDefinition>(initialDraft);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [publishing, setPublishing] = useState(false);
  // Tracks whether a draft exists server-side. Starts from the prop ;
  // flips to true the moment the auto-save persists the first edit
  // ("dirty" client state turns into "server has a draft") ; flips to
  // false right after Publish or Discard succeeds.
  const [hasPendingDraft, setHasPendingDraft] = useState(initialHasPendingDraft);
  const [insertCtx, setInsertCtx] = useState<{ sourceId: string; slot: string } | null>(null);
  const [deletePathFor, setDeletePathFor] = useState<DraftStep | null>(null);
  const [keepChoice, setKeepChoice] = useState<{ slot: string | null } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [joining, setJoining] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counter = useRef(initialDraft.steps.length + 1);
  const readOnly = lockedByOther;

  const localeCtx = useMemo(
    () => ({
      contact: { preferredLanguage: orgLocale },
      company: { primaryLocale: orgLocale },
      organization: { defaultLocale: orgLocale },
    }),
    [orgLocale],
  );

  useEffect(() => {
    if (readOnly) return;
    const fd = new FormData();
    fd.set("sequenceId", sequenceId);
    void startEditingAction(fd);
    return () => {
      const out = new FormData();
      out.set("sequenceId", sequenceId);
      void releaseLockAction(out);
    };
  }, [sequenceId, readOnly]);

  const scheduleSave = useCallback(
    (next: DraftDefinition) => {
      if (readOnly) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaveState("saving");
      saveTimer.current = setTimeout(async () => {
        try {
          const fd = new FormData();
          fd.set("sequenceId", sequenceId);
          fd.set("draft", JSON.stringify(next));
          await saveDraftAction(fd);
          setSaveState("saved");
          setHasPendingDraft(true);
        } catch (err) {
          // Match the publish handler — log the real reason instead of
          // silently flagging "error". An auto-save failure is the most
          // common cause of "publish says no_draft".
          console.error("[sequence-editor] auto-save failed", err);
          setSaveState("error");
        }
      }, 800);
    },
    [sequenceId, readOnly],
  );

  const mutate = useCallback(
    (next: DraftDefinition) => {
      // Every structural edit goes through here ; GC keeps the graph connected
      // (a removed switch branch / deleted step can never leave an orphan
      // island the UI has no insert-point to reconnect).
      const gced = gcUnreachableSteps(next);
      setDraft(gced);
      scheduleSave(gced);
    },
    [scheduleSave],
  );

  // --- graph (shared builder ; per-open-branch End nodes → dagre fans out) ---
  const { nodes: baseNodes, edges: baseEdges } = useMemo(
    () => buildSequenceGraph(draft, { t: t as never, localeCtx, triggerSummary }),
    [draft, t, localeCtx, triggerSummary],
  );

  const { nodes, edgePoints, edgeLaneX } = useSequenceLayout(baseNodes, baseEdges);
  const anchorTop = useAnchorTopViewport(nodes);
  // Attach routing points + the branch lane X so edges render consistently.
  const edges = useMemo(
    () =>
      baseEdges.map((e) => ({
        ...e,
        data: { ...e.data, points: edgePoints[e.id], laneX: edgeLaneX[e.id] },
      })),
    [baseEdges, edgePoints, edgeLaneX],
  );

  // --- mutations ---
  const updateStep = (next: DraftStep) =>
    mutate({ ...draft, steps: draft.steps.map((s) => (s.id === next.id ? next : s)) });

  const slotTarget = (sourceId: string, slot: string): string | null => {
    if (sourceId === TRIGGER_ID) return draft.entryStepId || null;
    const step = draft.steps.find((s) => s.id === sourceId);
    if (!step?.nextStepIds) return null;
    if (slot === "default") return step.nextStepIds.default ?? null;
    if (slot === "yes") return step.nextStepIds.yes ?? null;
    if (slot === "no") return step.nextStepIds.no ?? null;
    if (slot.startsWith("case:")) return step.nextStepIds.cases?.[slot.slice(5)] ?? null;
    return null;
  };

  const setSlot = (steps: DraftStep[], sourceId: string, slot: string, target: string): DraftStep[] =>
    steps.map((s) => {
      if (s.id !== sourceId) return s;
      const n: NonNullable<NextStepIds> = { ...(s.nextStepIds ?? {}) };
      if (slot === "default") n.default = target;
      else if (slot === "yes") n.yes = target;
      else if (slot === "no") n.no = target;
      else if (slot.startsWith("case:")) n.cases = { ...(n.cases ?? {}), [slot.slice(5)]: target };
      return { ...s, nextStepIds: n };
    });

  const insertStep = (type: SequenceStepActionType) => {
    if (!insertCtx) return;
    const { sourceId, slot } = insertCtx;
    const id = `step-${counter.current++}`;
    const oldTarget = slotTarget(sourceId, slot); // a real step id, or null (→ End)
    // Type-aware default wiring : a split sends YES to the continuation (old
    // target) and ELSE to End ; a switch sends its first branch to the
    // continuation and the rest to End ; everything else is linear.
    let nextStepIds: NextStepIds = null;
    if (oldTarget) {
      if (type === "conditional_split") nextStepIds = { yes: oldTarget };
      else if (type === "conditional_switch") nextStepIds = { cases: { "0": oldTarget } };
      else nextStepIds = { default: oldTarget };
    }
    const newStep: DraftStep = {
      id,
      stepOrder: draft.steps.length,
      actionType: type,
      actionConfig: defaultConfig(type),
      nextStepIds,
      condition: null,
      filter: null,
    };

    let nextDraft: DraftDefinition;
    if (sourceId === TRIGGER_ID) {
      nextDraft = { entryStepId: id, steps: [...draft.steps, newStep] };
    } else {
      const steps = setSlot([...draft.steps, newStep], sourceId, slot, id);
      nextDraft = { ...draft, steps };
    }
    mutate(nextDraft);
    setSelectedId(id);
    setInsertCtx(null);
  };

  const deleteStep = (id: string) => {
    const removed = draft.steps.find((s) => s.id === id);
    // A conditional has several outgoing paths : deleting it can't silently
    // nuke them, so ask which path to keep (the kept subtree is spliced in).
    if (
      removed &&
      (removed.actionType === "conditional_split" || removed.actionType === "conditional_switch")
    ) {
      setKeepChoice(null);
      setDeletePathFor(removed);
      return;
    }
    // Merge node : deleting it un-merges (re-opens the joined branches).
    if (removed?.actionType === "merge") {
      mutate(unmergeStep(draft, id));
      setSelectedId(null);
      return;
    }
    // Linear step : heal the chain (predecessors skip to its `default`).
    const heal = removed?.nextStepIds?.default;
    const remaining = draft.steps.filter((s) => s.id !== id);
    const steps = repointRefs(remaining, id, heal);
    const isEntry = id === draft.entryStepId;
    const entryStepId = isEntry ? (heal ?? remaining[0]?.id ?? "") : draft.entryStepId;
    mutate({ entryStepId, steps });
    setSelectedId(isEntry ? entryStepId || null : draft.entryStepId);
  };

  const confirmDeletePath = () => {
    if (!deletePathFor || !keepChoice) return;
    const next = deleteStepKeepingPath(draft, deletePathFor.id, keepChoice.slot);
    mutate(next);
    setSelectedId(next.entryStepId || null);
    setDeletePathFor(null);
    setKeepChoice(null);
  };

  // Outgoing paths offered in the "delete path" dialog : keep one (promote its
  // subtree) or delete every path.
  const keepOptions: { slot: string | null; label: string }[] = deletePathFor
    ? deletePathFor.actionType === "conditional_split"
      ? [
          { slot: "yes", label: t("editor.deletePath.keepYes") },
          { slot: "no", label: t("editor.deletePath.keepNo") },
          { slot: null, label: t("editor.deletePath.deleteAll") },
        ]
      : [
          ...((deletePathFor.actionConfig as { branches?: unknown[] }).branches ?? []).map(
            (_b, i) => ({ slot: `case:${i}`, label: t("editor.deletePath.keepBranch", { n: i + 1 }) }),
          ),
          { slot: "default", label: t("editor.deletePath.keepElse") },
          { slot: null, label: t("editor.deletePath.deleteAll") },
        ]
    : [];

  const onPublish = async () => {
    setPublishing(true);
    try {
      const fd = new FormData();
      fd.set("sequenceId", sequenceId);
      await publishSequenceAction(fd);
      router.push(`/sequences/${sequenceId}`);
    } catch (err) {
      // Log the real error so we can debug. The previous `catch {}` made
      // every failure look identical. Keep the local state in sync so
      // the spinner clears and the inline error banner appears.
      console.error("[sequence-editor] publish failed", err);
      setPublishing(false);
      setSaveState("error");
    }
  };

  const onDiscard = async () => {
    const fd = new FormData();
    fd.set("sequenceId", sequenceId);
    await discardDraftAction(fd);
    router.push(`/sequences/${sequenceId}`);
  };

  // Move an existing step onto a "+" (drag & drop). No-op / illegal moves
  // return null and are ignored.
  const onMoveStep = (stepId: string, sourceId: string, slot: string) => {
    const next = moveStep(draft, stepId, sourceId === TRIGGER_ID ? null : sourceId, slot);
    if (next) {
      mutate(next);
      setSelectedId(stepId);
    }
  };

  // Join two open branch ends into a new merge node.
  const onJoin = (aSource: string, aSlot: string, bSource: string, bSlot: string) => {
    const mergeId = `step-${counter.current++}`;
    const next = joinBranches(draft, mergeId, aSource, aSlot, bSource, bSlot);
    if (next) mutate(next);
  };

  const selectedStep = draft.steps.find((s) => s.id === selectedId) ?? null;

  return (
    <SequenceFlowContext.Provider
      value={{
        onInsert: (sourceId, slot) => setInsertCtx({ sourceId, slot }),
        onSelectTrigger: () => setSelectedId(TRIGGER_ID),
        readOnly,
        onMoveStep,
        onJoin,
        onDragStateChange: setDragging,
        onJoinStateChange: setJoining,
        dragging,
        joining,
        selectedId,
        dragHint: t("editor.move.hint"),
        joinHint: t("editor.join.hint"),
      }}
    >
      <div className="flex h-[calc(100vh-8rem)] flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
          <Button variant="ghost" size="sm" onClick={() => router.push(`/sequences/${sequenceId}`)}>
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            {t("editor.back")}
          </Button>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {saveState === "saving" && t("editor.saving")}
              {saveState === "saved" && t("editor.saved")}
              {saveState === "error" && t("editor.saveError")}
            </span>
            {!readOnly && (
              <>
                {hasPendingDraft && (
                  <Button variant="outline" size="sm" onClick={onDiscard}>
                    {t("editor.discard")}
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={onPublish}
                  disabled={publishing || !hasPendingDraft}
                  title={!hasPendingDraft ? t("editor.publishNoDraftTitle") : undefined}
                >
                  {publishing && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  {t("editor.publish")}
                </Button>
              </>
            )}
          </div>
        </div>

        {readOnly && (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {t("editor.lockedBanner")}
          </div>
        )}

        <div className="flex flex-1 gap-3 overflow-hidden pt-3">
          <div className="flex-1 overflow-hidden rounded-lg border border-border">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable
              fitView
              onInit={anchorTop.onInit}
              onNodeClick={(_e, node) => {
                if (node.id !== TRIGGER_ID && !node.id.startsWith("__end")) setSelectedId(node.id);
              }}
              proOptions={{ hideAttribution: true }}
            >
              <Background />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>

          {!readOnly && selectedId === TRIGGER_ID && (
            <div className="w-80 shrink-0 space-y-4 rounded-lg border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold">{t("editor.trigger.title")}</h3>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="-mr-1 -mt-1 rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  aria-label={t("editor.close")}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Manual / Dynamic toggle. Dynamic is disabled (coming soon) ;
                  in manual mode there are no eligibility filters — every
                  contact added by hand is enrolled. */}
              <div className="flex gap-2">
                <button
                  type="button"
                  className="flex-1 rounded-md border border-brand-teal bg-brand-teal/10 px-3 py-1.5 text-sm font-medium"
                >
                  {t("editor.trigger.kind.manual")}
                </button>
                <button
                  type="button"
                  disabled
                  title={t("editor.comingSoon")}
                  className="flex-1 cursor-not-allowed rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground opacity-50"
                >
                  {t("editor.trigger.kind.dynamic")} ({t("editor.comingSoon")})
                </button>
              </div>

              <p className="text-xs text-muted-foreground">
                {t("editor.trigger.manualHint")}
              </p>
            </div>
          )}

          {!readOnly && selectedStep && selectedId !== TRIGGER_ID && (
            <div className="w-80 shrink-0 rounded-lg border border-border bg-card">
              <SequenceStepDetailPanel
                step={selectedStep}
                draft={draft}
                sequenceId={sequenceId}
                otherSequences={otherSequences}
                orgMembers={orgMembers}
                onChange={updateStep}
                onDelete={() => deleteStep(selectedStep.id)}
                onClose={() => setSelectedId(null)}
                canDelete={draft.steps.length > 1}
              />
            </div>
          )}
        </div>
      </div>

      {/* Insert palette popover */}
      {insertCtx && !readOnly && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setInsertCtx(null)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-border bg-card p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">{t("editor.palette")}</h3>
              <button type="button" onClick={() => setInsertCtx(null)} aria-label="close">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            <div className="space-y-3">
              {SEQUENCE_PALETTE_GROUPS.map((group) => (
                <div key={group.group}>
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t(`editor.groups.${group.group}`)}
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {group.types.map((type) => {
                      const Icon = ICONS[type];
                      const disabled = SEQUENCE_COMING_SOON.includes(type);
                      return (
                        <button
                          key={type}
                          type="button"
                          disabled={disabled}
                          onClick={() => insertStep(type)}
                          className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-2 text-left text-xs hover:border-brand-teal/40 disabled:opacity-40"
                        >
                          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                          {t(`stepType.${type}`)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Delete-path dialog (conditional split / switch) */}
      {deletePathFor && !readOnly && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setDeletePathFor(null)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-border bg-card p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-sm font-semibold">{t("editor.deletePath.title")}</h3>
              <button type="button" onClick={() => setDeletePathFor(null)} aria-label="close">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            <p className="mb-3 text-sm text-muted-foreground">{t("editor.deletePath.hint")}</p>
            <div className="space-y-1.5">
              {keepOptions.map((opt) => {
                const key = opt.slot ?? "__all";
                const checked = (keepChoice?.slot ?? "__all") === key && keepChoice != null;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setKeepChoice({ slot: opt.slot })}
                    className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm ${
                      checked ? "border-brand-teal bg-brand-teal/10" : "border-border"
                    }`}
                  >
                    {opt.label}
                    <span
                      className={`h-4 w-4 rounded-full border ${
                        checked ? "border-brand-teal bg-brand-teal" : "border-input"
                      }`}
                    />
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDeletePathFor(null)}>
                {t("editor.deletePath.cancel")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-destructive"
                disabled={!keepChoice}
                onClick={confirmDeletePath}
              >
                {t("editor.deletePath.confirm")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </SequenceFlowContext.Provider>
  );
}

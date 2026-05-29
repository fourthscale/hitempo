"use client";

import "@xyflow/react/dist/style.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ReactFlow, Background, Controls } from "@xyflow/react";
import {
  Mail,
  Phone,
  Send,
  Clock,
  GitBranch,
  Split,
  UserCog,
  Workflow,
  ArrowLeft,
  Loader2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DraftDefinition, DraftStep } from "@/lib/sequences/draft-schema";
import type { SequenceStepActionType, NextStepIds } from "@/lib/sequences/types";
import { SEQUENCE_PALETTE_GROUPS, SEQUENCE_COMING_SOON } from "@/lib/sequences/types";
import { emptyGroup } from "@/lib/sequences/conditions";
import { SequenceStepNode } from "./sequence-step-node";
import { SequenceStepDetailPanel } from "./sequence-step-detail-panel";
import { buildSequenceGraph } from "./build-sequence-graph";
import {
  SequenceFlowContext,
  SequenceInsertEdge,
  TriggerNode,
  TerminalNode,
} from "./sequence-flow-bits";
import { useDagreLayout } from "./use-dagre-layout";
import {
  saveDraftAction,
  publishSequenceAction,
  discardDraftAction,
  startEditingAction,
  releaseLockAction,
} from "@/lib/actions/sequences";

const nodeTypes = { sequenceStep: SequenceStepNode, trigger: TriggerNode, terminal: TerminalNode };
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
  }
}


export function SequenceEditor({
  sequenceId,
  initialDraft,
  otherSequences,
  orgMembers,
  orgLocale,
  lockedByOther,
  triggerSummary,
}: {
  sequenceId: string;
  initialDraft: DraftDefinition;
  otherSequences: { id: string; name: string }[];
  orgMembers: { id: string; name: string }[];
  orgLocale: string;
  lockedByOther: boolean;
  triggerSummary: string;
}) {
  const t = useTranslations("pages.sequences");
  const router = useRouter();
  const [draft, setDraft] = useState<DraftDefinition>(initialDraft);
  const [selectedId, setSelectedId] = useState<string | null>(initialDraft.entryStepId);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [publishing, setPublishing] = useState(false);
  const [insertCtx, setInsertCtx] = useState<{ sourceId: string; slot: string } | null>(null);
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
        } catch {
          setSaveState("error");
        }
      }, 800);
    },
    [sequenceId, readOnly],
  );

  const mutate = useCallback(
    (next: DraftDefinition) => {
      setDraft(next);
      scheduleSave(next);
    },
    [scheduleSave],
  );

  // --- graph (shared builder ; per-open-branch End nodes → dagre fans out) ---
  const { nodes: baseNodes, edges } = useMemo(
    () => buildSequenceGraph(draft, { t: t as never, localeCtx, triggerSummary }),
    [draft, t, localeCtx, triggerSummary],
  );

  const { nodes } = useDagreLayout(baseNodes, edges);

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
    if (id === draft.entryStepId) {
      // Re-point entry to the deleted step's default target (or first remaining).
      const removed = draft.steps.find((s) => s.id === id);
      const newEntry = removed?.nextStepIds?.default ?? draft.steps.find((s) => s.id !== id)?.id ?? "";
      const steps = pruneRefs(draft.steps.filter((s) => s.id !== id), id);
      mutate({ entryStepId: newEntry, steps });
      setSelectedId(newEntry || null);
      return;
    }
    mutate({ ...draft, steps: pruneRefs(draft.steps.filter((s) => s.id !== id), id) });
    setSelectedId(draft.entryStepId);
  };

  const onPublish = async () => {
    setPublishing(true);
    try {
      const fd = new FormData();
      fd.set("sequenceId", sequenceId);
      await publishSequenceAction(fd);
      router.push(`/sequences/${sequenceId}`);
    } catch {
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

  const selectedStep = draft.steps.find((s) => s.id === selectedId) ?? null;

  return (
    <SequenceFlowContext.Provider
      value={{ onInsert: (sourceId, slot) => setInsertCtx({ sourceId, slot }), onSelectTrigger: () => setSelectedId(TRIGGER_ID), readOnly }}
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
                <Button variant="outline" size="sm" onClick={onDiscard}>
                  {t("editor.discard")}
                </Button>
                <Button size="sm" onClick={onPublish} disabled={publishing}>
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
            <div className="w-80 shrink-0 rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold">{t("editor.trigger.title")}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{t("editor.trigger.manual")}</p>
              <p className="mt-3 text-xs text-muted-foreground">{triggerSummary}</p>
            </div>
          )}

          {!readOnly && selectedStep && selectedId !== TRIGGER_ID && (
            <div className="w-80 shrink-0 rounded-lg border border-border bg-card">
              <SequenceStepDetailPanel
                step={selectedStep}
                otherSequences={otherSequences}
                orgMembers={orgMembers}
                onChange={updateStep}
                onDelete={() => deleteStep(selectedStep.id)}
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
    </SequenceFlowContext.Provider>
  );
}

/** Remove references to a deleted step id from every step's nextStepIds. */
function pruneRefs(steps: DraftStep[], deletedId: string): DraftStep[] {
  return steps.map((s) => {
    if (!s.nextStepIds) return s;
    const n: NonNullable<NextStepIds> = { ...s.nextStepIds };
    if (n.default === deletedId) delete n.default;
    if (n.yes === deletedId) delete n.yes;
    if (n.no === deletedId) delete n.no;
    if (n.cases) {
      n.cases = Object.fromEntries(Object.entries(n.cases).filter(([, v]) => v !== deletedId));
      if (Object.keys(n.cases).length === 0) delete n.cases;
    }
    return { ...s, nextStepIds: Object.keys(n).length ? n : null };
  });
}

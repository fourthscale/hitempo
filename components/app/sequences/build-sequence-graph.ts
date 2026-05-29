import { MarkerType, type Edge, type Node } from "@xyflow/react";
import { resolveLocalizedString } from "@/lib/sequences/locale-resolver";
import type { DraftDefinition, DraftStep } from "@/lib/sequences/draft-schema";
import type { LocalizedString } from "@/lib/sequences/types";
import type { SequenceStepNodeData } from "./sequence-step-node";

export const TRIGGER_ID = "__trigger";

type LocaleCtx = Parameters<typeof resolveLocalizedString>[1];
type T = (key: string, values?: Record<string, string | number>) => string;

/**
 * Builds the React Flow graph (nodes + edges + per-open-branch terminal node
 * ids) for a sequence draft. Shared by the editor (interactive) and the
 * read-only detail view so both render the exact same flow — only the
 * interaction layer differs.
 *
 * Each open branch gets its own `__end:*` terminal node so dagre lays branches
 * out in separate columns. Nodes come back at {0,0} ; the caller runs the
 * dagre layout hook to position them.
 */
export function buildSequenceGraph(
  draft: DraftDefinition,
  opts: { t: T; localeCtx: LocaleCtx; triggerSummary: string },
): { nodes: Node[]; edges: Edge[]; endNodeIds: string[] } {
  const { t, localeCtx, triggerSummary } = opts;

  const stepLabel = (step: DraftStep): string => {
    const cfg = step.actionConfig as {
      titleTemplate?: LocalizedString;
      durationValue?: number;
      durationUnit?: string;
    };
    if (step.actionType === "wait_delay") {
      return `${cfg.durationValue ?? "?"} ${cfg.durationUnit ?? ""}`.trim();
    }
    if (cfg.titleTemplate) {
      const r = resolveLocalizedString(cfg.titleTemplate, localeCtx);
      if (r) return r;
    }
    return t(`stepType.${step.actionType}`);
  };

  // --- edges + per-open-branch terminal nodes ---
  const edges: Edge[] = [];
  const endNodeIds: string[] = [];
  const byId = new Set(draft.steps.map((s) => s.id));
  const endFor = (source: string, slot: string) => {
    const id = `__end:${source}:${slot}`;
    endNodeIds.push(id);
    return id;
  };
  const edge = (source: string, target: string, slot: string, label?: string): Edge => ({
    id: `${source}:${slot}->${target}`,
    source,
    target,
    type: "insertable",
    label,
    data: { sourceId: source, slot },
    markerEnd: { type: MarkerType.ArrowClosed },
  });
  const resolve = (source: string, slot: string, target: string | undefined) =>
    target && byId.has(target) ? target : endFor(source, slot);

  edges.push(
    edge(TRIGGER_ID, byId.has(draft.entryStepId) ? draft.entryStepId : endFor(TRIGGER_ID, "entry"), "entry"),
  );

  for (const step of draft.steps) {
    const n = step.nextStepIds;
    if (step.actionType === "conditional_split") {
      edges.push(edge(step.id, resolve(step.id, "yes", n?.yes), "yes", t("editor.branch.yes")));
      edges.push(edge(step.id, resolve(step.id, "no", n?.no), "no", t("editor.branch.no")));
    } else if (step.actionType === "conditional_switch") {
      const cases = (n?.cases ?? {}) as Record<string, string>;
      const branches = (step.actionConfig as { branches?: unknown[] }).branches ?? [];
      branches.forEach((_b, i) =>
        edges.push(edge(step.id, resolve(step.id, `case:${i}`, cases[String(i)]), `case:${i}`, t("editor.switch.branch", { n: i + 1 }))),
      );
      edges.push(edge(step.id, resolve(step.id, "default", n?.default), "default", t("editor.branch.default")));
    } else {
      edges.push(edge(step.id, resolve(step.id, "default", n?.default), "default"));
    }
  }

  // --- nodes ---
  const stepNodes: Node[] = draft.steps.map((step) => {
    const data: SequenceStepNodeData = {
      actionType: step.actionType,
      typeLabel: t(`stepType.${step.actionType}`),
      summary: stepLabel(step),
      conditionBadge: step.condition ? t(`editor.conditions.${step.condition.type}`) : null,
      isEntry: step.id === draft.entryStepId,
    };
    return {
      id: step.id,
      type: "sequenceStep",
      position: { x: 0, y: 0 },
      data: data as unknown as Record<string, unknown>,
    };
  });
  const endNodes: Node[] = endNodeIds.map((id) => ({
    id,
    type: "terminal",
    position: { x: 0, y: 0 },
    data: { label: t("editor.end") } as Record<string, unknown>,
  }));

  const nodes: Node[] = [
    {
      id: TRIGGER_ID,
      type: "trigger",
      position: { x: 0, y: 0 },
      data: { label: t("editor.trigger.title"), summary: triggerSummary } as Record<string, unknown>,
    },
    ...stepNodes,
    ...endNodes,
  ];

  return { nodes, edges, endNodeIds };
}

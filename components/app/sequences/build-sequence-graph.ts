import { MarkerType, type Edge, type Node } from "@xyflow/react";
import { resolveLocalizedString } from "@/lib/sequences/locale-resolver";
import type { DraftDefinition, DraftStep } from "@/lib/sequences/draft-schema";
import type { LocalizedString } from "@/lib/sequences/types";
import type { SequenceStepNodeData, SequenceStepRunState } from "./sequence-step-node";

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
  opts: {
    t: T;
    localeCtx: LocaleCtx;
    triggerSummary: string;
    /** Per-step runtime state (enrolment detail view only). */
    stepStates?: Record<string, SequenceStepRunState>;
    /**
     * Edges that the engine actually traversed for this enrolment. Pair
     * format `"${sourceId}->${targetId}"` (TRIGGER_ID is a valid source).
     * Used to colour the traversed path green on the enrolment detail view.
     */
    traversedEdges?: ReadonlySet<string>;
    /** True if the enrolment ever started — colours the trigger node green. */
    triggerExecuted?: boolean;
  },
): { nodes: Node[]; edges: Edge[]; endNodeIds: string[] } {
  const { t, localeCtx, triggerSummary, stepStates, traversedEdges, triggerExecuted } = opts;

  const stepLabel = (step: DraftStep): string => {
    const cfg = step.actionConfig as {
      titleTemplate?: LocalizedString;
      durationValue?: number;
      durationUnit?: string;
    };
    if (cfg.titleTemplate) {
      const r = resolveLocalizedString(cfg.titleTemplate, localeCtx);
      if (r) return r;
    }
    if (step.actionType === "wait_delay") {
      return `${cfg.durationValue ?? "?"} ${cfg.durationUnit ?? ""}`.trim();
    }
    // No title set → show nothing (the node already shows the type label).
    return "";
  };

  // --- edges + per-open-branch terminal nodes ---
  const edges: Edge[] = [];
  const endMeta: { id: string; source: string; slot: string }[] = [];
  const byId = new Set(draft.steps.map((s) => s.id));
  const endFor = (source: string, slot: string) => {
    const id = `__end:${source}:${slot}`;
    endMeta.push({ id, source, slot });
    return id;
  };
  const mergeStepIds = new Set(
    draft.steps.filter((s) => s.actionType === "merge").map((s) => s.id),
  );
  const edge = (
    source: string,
    target: string,
    slot: string,
    label?: string,
    branch?: { index: number; count: number },
  ): Edge => {
    const traversed = traversedEdges?.has(`${source}->${target}`);
    return {
      id: `${source}:${slot}->${target}`,
      source,
      target,
      type: "insertable",
      label,
      data: {
        sourceId: source,
        slot,
        // Open branch end → offer a join handle on this edge.
        targetIsEnd: target.startsWith("__end:"),
        // Target is a merge (convergence) → fan near the source, not the merge col.
        targetIsMerge: mergeStepIds.has(target),
        // Position among the source's sibling branches (for fan-out lanes).
        branchIndex: branch?.index,
        branchCount: branch?.count,
        runState: traversed ? "traversed" : undefined,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        // Match the traversed stroke colour so the arrow head doesn't stay
        // black on top of a green line.
        ...(traversed ? { color: "#10b981" } : {}),
      },
    };
  };
  const resolve = (source: string, slot: string, target: string | undefined) =>
    target && byId.has(target) ? target : endFor(source, slot);

  edges.push(
    edge(TRIGGER_ID, byId.has(draft.entryStepId) ? draft.entryStepId : endFor(TRIGGER_ID, "entry"), "entry"),
  );

  for (const step of draft.steps) {
    const n = step.nextStepIds;
    if (step.actionType === "conditional_split") {
      edges.push(edge(step.id, resolve(step.id, "yes", n?.yes), "yes", t("editor.branch.yes"), { index: 0, count: 2 }));
      edges.push(edge(step.id, resolve(step.id, "no", n?.no), "no", t("editor.branch.no"), { index: 1, count: 2 }));
    } else if (step.actionType === "conditional_switch") {
      const cases = (n?.cases ?? {}) as Record<string, string>;
      const branches = (step.actionConfig as { branches?: unknown[] }).branches ?? [];
      const count = branches.length + 1;
      branches.forEach((_b, i) =>
        edges.push(
          edge(step.id, resolve(step.id, `case:${i}`, cases[String(i)]), `case:${i}`, t("editor.switch.branch", { n: i + 1 }), { index: i, count }),
        ),
      );
      edges.push(edge(step.id, resolve(step.id, "default", n?.default), "default", t("editor.branch.default"), { index: branches.length, count }));
    } else {
      edges.push(edge(step.id, resolve(step.id, "default", n?.default), "default"));
    }
  }

  // --- nodes ---
  const stepNodes: Node[] = draft.steps.map((step) => {
    // Merge is a compact passthrough node (its own renderer), not a card.
    if (step.actionType === "merge") {
      return {
        id: step.id,
        type: "merge",
        position: { x: 0, y: 0 },
        data: { label: t("stepType.merge") } as Record<string, unknown>,
      };
    }
    const data: SequenceStepNodeData = {
      actionType: step.actionType,
      typeLabel: t(`stepType.${step.actionType}`),
      summary: stepLabel(step),
      conditionBadge: step.condition ? t(`editor.conditions.${step.condition.type}`) : null,
      isEntry: step.id === draft.entryStepId,
      runState: stepStates?.[step.id],
    };
    return {
      id: step.id,
      type: "sequenceStep",
      position: { x: 0, y: 0 },
      data: data as unknown as Record<string, unknown>,
    };
  });
  const endNodes: Node[] = endMeta.map((e) => ({
    id: e.id,
    type: "terminal",
    position: { x: 0, y: 0 },
    data: { label: t("editor.end"), sourceId: e.source, slot: e.slot } as Record<string, unknown>,
  }));

  const nodes: Node[] = [
    {
      id: TRIGGER_ID,
      type: "trigger",
      position: { x: 0, y: 0 },
      data: {
        label: t("editor.trigger.title"),
        summary: triggerSummary,
        runState: triggerExecuted ? "executed" : undefined,
      } as Record<string, unknown>,
    },
    ...stepNodes,
    ...endNodes,
  ];

  return { nodes, edges, endNodeIds: endMeta.map((e) => e.id) };
}

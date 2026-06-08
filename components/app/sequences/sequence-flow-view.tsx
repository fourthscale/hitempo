"use client";

import "@xyflow/react/dist/style.css";

import { useMemo } from "react";
import { ReactFlow, Background, Controls } from "@xyflow/react";
import { anchorTopOnInit } from "./anchor-top-viewport";
import { useTranslations } from "next-intl";
import type { DraftDefinition } from "@/lib/sequences/draft-schema";
import { SequenceStepNode } from "./sequence-step-node";
import {
  SequenceFlowContext,
  SequenceInsertEdge,
  TriggerNode,
  TerminalNode,
  MergeNode,
} from "./sequence-flow-bits";
import { useSequenceLayout } from "./use-sequence-layout";
import { buildSequenceGraph } from "./build-sequence-graph";
import type { SequenceStepRunState } from "./sequence-step-node";

const nodeTypes = {
  sequenceStep: SequenceStepNode,
  trigger: TriggerNode,
  terminal: TerminalNode,
  merge: MergeNode,
};
const edgeTypes = { insertable: SequenceInsertEdge };
const NOOP_CTX = { onInsert: () => {}, onSelectTrigger: () => {}, readOnly: true };

/**
 * Read-only render of a sequence flow — the same graph the editor draws, but
 * frozen : no "+" insert buttons (readOnly context), no palette, no panel, no
 * dragging or selection. Used on the detail page in place of a step list.
 */
export function SequenceFlowView({
  draft,
  orgLocale,
  triggerSummary,
  stepStates,
  traversedEdges,
  triggerExecuted,
}: {
  draft: DraftDefinition;
  orgLocale: string;
  triggerSummary: string;
  /** Per-step runtime status (enrolment detail view). Omit on the sequence
   *  detail view — all steps render in the default neutral style. */
  stepStates?: Record<string, SequenceStepRunState>;
  /** Edges actually traversed by the cursor (`"sourceId->targetId"`). */
  traversedEdges?: ReadonlySet<string>;
  /** True if the enrolment ever started — colours the trigger node green. */
  triggerExecuted?: boolean;
}) {
  const t = useTranslations("pages.sequences");
  const localeCtx = useMemo(
    () => ({
      contact: { preferredLanguage: orgLocale },
      company: { primaryLocale: orgLocale },
      organization: { defaultLocale: orgLocale },
    }),
    [orgLocale],
  );
  const { nodes: baseNodes, edges: baseEdges } = useMemo(
    () =>
      buildSequenceGraph(draft, {
        t: t as never,
        localeCtx,
        triggerSummary,
        stepStates,
        traversedEdges,
        triggerExecuted,
      }),
    [draft, t, localeCtx, triggerSummary, stepStates, traversedEdges, triggerExecuted],
  );
  const { nodes, edgePoints, edgeLaneX } = useSequenceLayout(baseNodes, baseEdges);
  const edges = useMemo(
    () =>
      baseEdges.map((e) => ({
        ...e,
        data: { ...e.data, points: edgePoints[e.id], laneX: edgeLaneX[e.id] },
      })),
    [baseEdges, edgePoints, edgeLaneX],
  );

  return (
    <SequenceFlowContext.Provider value={NOOP_CTX}>
      <div className="h-[560px] overflow-hidden rounded-lg border border-border">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          fitView
          onInit={anchorTopOnInit}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </SequenceFlowContext.Provider>
  );
}

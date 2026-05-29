"use client";

import "@xyflow/react/dist/style.css";

import { useMemo } from "react";
import { ReactFlow, Background, Controls } from "@xyflow/react";
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
}: {
  draft: DraftDefinition;
  orgLocale: string;
  triggerSummary: string;
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
    () => buildSequenceGraph(draft, { t: t as never, localeCtx, triggerSummary }),
    [draft, t, localeCtx, triggerSummary],
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
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </SequenceFlowContext.Provider>
  );
}

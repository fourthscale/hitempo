"use client";

import { createContext, useContext } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  Handle,
  Position,
  type EdgeProps,
  type NodeProps,
} from "@xyflow/react";
import { Plus, Zap, Flag } from "lucide-react";

/**
 * Shared canvas context : the custom edge's "+" button and the trigger node
 * call back into the editor without prop-drilling through React Flow.
 */
export type SequenceFlowCtx = {
  /** Insert a step on the edge leaving `sourceId` via `slot` (default/yes/no/case key). */
  onInsert: (sourceId: string, slot: string) => void;
  /** Open the trigger (targeting) panel. */
  onSelectTrigger: () => void;
  readOnly: boolean;
};

export const SequenceFlowContext = createContext<SequenceFlowCtx>({
  onInsert: () => {},
  onSelectTrigger: () => {},
  readOnly: true,
});

// ---------------------------------------------------------------------------
// Trigger node (top, special)
// ---------------------------------------------------------------------------

export function TriggerNode({ data }: NodeProps) {
  const ctx = useContext(SequenceFlowContext);
  const d = data as unknown as { label: string; summary: string };
  return (
    <button
      type="button"
      onClick={ctx.onSelectTrigger}
      className="w-[260px] rounded-lg border border-foreground/20 bg-foreground/[0.03] px-3 py-2.5 text-left shadow-sm hover:border-brand-teal/40"
    >
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-background">
          <Zap className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground">{d.label}</p>
          <p className="truncate text-xs text-muted-foreground">{d.summary}</p>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-foreground/40" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Terminal (End) node (bottom, implicit)
// ---------------------------------------------------------------------------

export function TerminalNode({ data }: NodeProps) {
  const d = data as unknown as { label: string };
  // Fixed width (matches the dagre box) + centered content so the node's real
  // center aligns with the column — otherwise a fluid pill sits left-of-centre.
  return (
    <div className="flex w-[120px] items-center justify-center gap-2 rounded-full border border-border bg-secondary px-3 py-1.5 text-xs text-muted-foreground">
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground/40" />
      <Flag className="h-3 w-3" />
      {d.label}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Insert edge : a "+" button at the midpoint to add a step at that position
// ---------------------------------------------------------------------------

export function SequenceInsertEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, label } = props;
  const ctx = useContext(SequenceFlowContext);
  const d = data as unknown as { sourceId: string; slot: string } | undefined;

  let edgePath: string;
  let labelX: number;
  let labelY: number;
  if (Math.abs(targetX - sourceX) > 1) {
    // Branch edge : drop to a shared horizontal "bus" just below the source,
    // run across to the branch column, then down. All siblings share the same
    // bus Y so their horizontal segments line up. Targets are already in their
    // own columns (per-branch End), so no crossing.
    const busY = sourceY + 28;
    edgePath = `M ${sourceX},${sourceY} L ${sourceX},${busY} L ${targetX},${busY} L ${targetX},${targetY}`;
    labelX = targetX;
    labelY = (busY + targetY) / 2;
  } else {
    // Linear edge : straight orthogonal step between handles.
    [edgePath, labelX, labelY] = getSmoothStepPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });
  }

  return (
    <>
      <BaseEdge id={id} path={edgePath} />
      <EdgeLabelRenderer>
        <div
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          className="pointer-events-auto absolute flex flex-col items-center gap-1"
        >
          {label && (
            <span className="rounded bg-background px-1 text-[10px] text-muted-foreground shadow-sm">
              {label}
            </span>
          )}
          {!ctx.readOnly && d && (
            <button
              type="button"
              onClick={() => ctx.onInsert(d.sourceId, d.slot)}
              className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm hover:border-brand-teal hover:text-brand-teal"
              aria-label="insert step"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

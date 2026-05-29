"use client";

import { createContext, useContext, useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  Position,
  type EdgeProps,
  type NodeProps,
} from "@xyflow/react";
import { Plus, Zap, Flag, GitMerge } from "lucide-react";
import { cn } from "@/lib/utils";
import { SEQUENCE_GAP } from "./use-sequence-layout";

/** dataTransfer MIME carrying a dragged step id (move onto a "+"). */
export const STEP_DRAG_MIME = "application/hitempo-step";
/** dataTransfer MIME carrying a dragged branch end "sourceId::slot" (join). */
export const JOIN_DRAG_MIME = "application/hitempo-join";

/**
 * Shared canvas context : custom nodes / edges call back into the editor
 * without prop-drilling through React Flow.
 */
export type SequenceFlowCtx = {
  /** Insert a step on the edge leaving `sourceId` via `slot`. */
  onInsert: (sourceId: string, slot: string) => void;
  /** Open the trigger (targeting) panel. */
  onSelectTrigger: () => void;
  readOnly: boolean;
  /** Move an existing step to the "+" leaving `sourceId` via `slot`. */
  onMoveStep?: (stepId: string, sourceId: string, slot: string) => void;
  /** Join two open branch ends (creates a merge node both point to). */
  onJoin?: (aSource: string, aSlot: string, bSource: string, bSlot: string) => void;
  /** Notified when a step drag begins / ends (to surface drop targets). */
  onDragStateChange?: (dragging: boolean) => void;
  /** Notified when a join drag begins / ends (to surface join drop targets). */
  onJoinStateChange?: (joining: boolean) => void;
  /** True while a step is being dragged — used to surface "+" drop zones. */
  dragging?: boolean;
  /** True while a join is being dragged — used to surface join drop zones. */
  joining?: boolean;
  dragHint?: string;
  joinHint?: string;
  /** Currently selected step id (drives the node's selected border). */
  selectedId?: string | null;
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
// Merge node : compact passthrough where branches converge (join)
// ---------------------------------------------------------------------------

export function MergeNode({ id, data }: NodeProps) {
  const ctx = useContext(SequenceFlowContext);
  const d = data as unknown as { label: string };
  const selected = ctx.selectedId === id;
  // Selecting the merge opens the side panel (type "Join") where it can be
  // deleted (which un-merges). No direct action on the node itself.
  return (
    <div
      title={d.label}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-md border bg-card text-muted-foreground shadow-sm",
        selected ? "border-brand-teal ring-1 ring-brand-teal/30" : "border-border",
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground/40" />
      <GitMerge className="h-4 w-4" />
      <Handle type="source" position={Position.Bottom} className="!bg-brand-teal" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Terminal (End) node
// ---------------------------------------------------------------------------

export function TerminalNode({ data }: NodeProps) {
  const d = data as unknown as { label: string };
  return (
    <div className="flex w-[120px] items-center justify-center gap-2 rounded-full border border-border bg-secondary px-3 py-1.5 text-xs text-muted-foreground">
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground/40" />
      <Flag className="h-3 w-3" />
      {d.label}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Join handle : a draggable / droppable control on an open branch end. Drag
// one onto another to converge the two branches through a merge node.
// ---------------------------------------------------------------------------

function JoinHandle({ sourceId, slot }: { sourceId: string; slot: string }) {
  const ctx = useContext(SequenceFlowContext);
  const [over, setOver] = useState(false);
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(JOIN_DRAG_MIME, `${sourceId}::${slot}`);
        e.dataTransfer.effectAllowed = "link";
        ctx.onJoinStateChange?.(true);
      }}
      onDragEnd={() => ctx.onJoinStateChange?.(false)}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(JOIN_DRAG_MIME)) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const [aSource, aSlot] = e.dataTransfer.getData(JOIN_DRAG_MIME).split("::");
        if (aSource && aSlot && !(aSource === sourceId && aSlot === slot)) {
          ctx.onJoin?.(aSource, aSlot, sourceId, slot);
        }
      }}
      title={ctx.joinHint}
      className={cn(
        "nodrag nopan flex cursor-grab items-center justify-center rounded-md border shadow-sm transition-all active:cursor-grabbing hover:border-brand-teal hover:text-brand-teal",
        // Grow into a clear drop zone while a join is being dragged.
        ctx.joining ? "h-10 w-10 border-dashed bg-secondary" : "h-6 w-6 bg-background",
        over
          ? "border-brand-teal text-brand-teal ring-2 ring-brand-teal/40 bg-brand-teal/10"
          : ctx.joining
            ? "border-muted-foreground/40 text-muted-foreground"
            : "border-border text-muted-foreground",
      )}
      aria-label="join branch"
    >
      <GitMerge className="h-3.5 w-3.5" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Insert edge : a "+" button at the midpoint — insert a step, or a drop target
// to move an existing step here.
// ---------------------------------------------------------------------------

type InsertEdgeData = {
  sourceId: string;
  slot: string;
  targetIsEnd?: boolean;
  points?: { x: number; y: number }[];
  /** Absolute X of this branch's descent lane (from the layout). */
  laneX?: number;
  branchCount?: number;
};

export function SequenceInsertEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, data, label } = props;
  const ctx = useContext(SequenceFlowContext);
  const d = data as unknown as InsertEdgeData | undefined;
  const [dropActive, setDropActive] = useState(false);

  // Orthogonal routing (no diagonals). A split/switch branch fans out to its
  // own horizontal "lane" right below the node, descends in that lane (where
  // its label + controls live), then converges to the target — so sibling
  // branches never overlap, even when they all merge. When the target already
  // sits in its own distinct column (diverging branches), the lane IS that
  // column. Linear edges use the layout's pre-computed points.
  const branchCount = d?.branchCount ?? 1;
  const isFanned = branchCount > 1;
  // The layout assigns each branch a dedicated descent lane (in declared order)
  // — use it so sibling branches keep their left→right order and never overlap.
  const laneX = isFanned && d?.laneX != null ? d.laneX : targetX;

  let pts: { x: number; y: number }[];
  if (isFanned) {
    // Orthogonal fan : straight down out of the split, horizontal jog on the
    // bus to the branch lane, straight down the lane, then converge to the
    // target. No diagonal segments.
    const busY = sourceY + 28;
    const botY = Math.max(targetY - 36, sourceY + 3 * SEQUENCE_GAP + 16);
    pts = [
      { x: sourceX, y: sourceY },
      { x: sourceX, y: busY },
      { x: laneX, y: busY },
      { x: laneX, y: botY },
      { x: targetX, y: botY },
      { x: targetX, y: targetY },
    ];
  } else if (d?.points && d.points.length >= 2) {
    pts = [{ x: sourceX, y: sourceY }, ...d.points.slice(1, -1), { x: targetX, y: targetY }];
  } else {
    pts = [
      { x: sourceX, y: sourceY },
      { x: sourceX, y: (sourceY + targetY) / 2 },
      { x: targetX, y: (sourceY + targetY) / 2 },
      { x: targetX, y: targetY },
    ];
  }
  const edgePath = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x},${p.y}`).join(" ");

  // The label and controls must sit ON the line : anchor them to the longest
  // vertical segment of the path (the "body" of the branch).
  let vseg = { x: targetX, y0: Math.min(sourceY, targetY), y1: Math.max(sourceY, targetY) };
  let bestLen = -1;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (Math.abs(a.x - b.x) < 1) {
      const len = Math.abs(b.y - a.y);
      if (len > bestLen) {
        bestLen = len;
        vseg = { x: a.x, y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) };
      }
    }
  }

  const canDrop = !ctx.readOnly && Boolean(ctx.onMoveStep) && Boolean(d);
  const showJoin = !ctx.readOnly && Boolean(d?.targetIsEnd) && Boolean(ctx.onJoin);

  // Consistent vertical rhythm : every element along the branch is one GAP
  // apart — split → label → "+" → join → next. The chain is anchored to the
  // top for branches (label first) and to the End for linear open ends.
  const GAP = SEQUENCE_GAP;
  const ctrlX = isFanned ? laneX : vseg.x;
  let labelY: number | null = null;
  let plusY: number;
  let joinY: number | null = null;
  if (isFanned) {
    let row = 1;
    if (label) labelY = sourceY + row++ * GAP;
    plusY = sourceY + row++ * GAP;
    if (showJoin) joinY = sourceY + row * GAP;
  } else if (showJoin) {
    joinY = vseg.y1 - GAP;
    plusY = vseg.y1 - 2 * GAP;
    if (label) labelY = vseg.y0 + GAP;
  } else {
    plusY = (vseg.y0 + vseg.y1) / 2;
    if (label) labelY = vseg.y0 + GAP;
  }
  const at = (x: number, y: number) => ({
    transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
  });

  return (
    <>
      <BaseEdge id={id} path={edgePath} />
      <EdgeLabelRenderer>
        {label && labelY != null && (
          <span
            style={at(ctrlX, labelY)}
            className="pointer-events-none absolute rounded bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm"
          >
            {label}
          </span>
        )}
        {!ctx.readOnly && d && (
          <button
            type="button"
            style={at(ctrlX, plusY)}
            onClick={() => ctx.onInsert(d.sourceId, d.slot)}
            onDragOver={
              canDrop
                ? (e) => {
                    if (e.dataTransfer.types.includes(STEP_DRAG_MIME)) {
                      e.preventDefault();
                      setDropActive(true);
                    }
                  }
                : undefined
            }
            onDragLeave={canDrop ? () => setDropActive(false) : undefined}
            onDrop={
              canDrop
                ? (e) => {
                    e.preventDefault();
                    setDropActive(false);
                    const stepId = e.dataTransfer.getData(STEP_DRAG_MIME);
                    if (stepId && d) ctx.onMoveStep?.(stepId, d.sourceId, d.slot);
                  }
                : undefined
            }
            className={cn(
              "pointer-events-auto absolute flex items-center justify-center rounded-full border shadow-sm transition-all hover:border-brand-teal hover:text-brand-teal",
              ctx.dragging && canDrop ? "h-10 w-10 border-dashed bg-secondary" : "h-6 w-6 bg-background",
              dropActive
                ? "border-brand-teal text-brand-teal ring-2 ring-brand-teal/40 bg-brand-teal/10"
                : ctx.dragging && canDrop
                  ? "border-muted-foreground/40 text-muted-foreground"
                  : "border-border text-muted-foreground",
            )}
            aria-label="insert step"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
        {showJoin && d && joinY != null && (
          <div style={at(ctrlX, joinY)} className="pointer-events-auto absolute">
            <JoinHandle sourceId={d.sourceId} slot={d.slot} />
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}

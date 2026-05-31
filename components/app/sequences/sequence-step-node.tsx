"use client";

import { useContext } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Mail, Phone, Send, Clock, GitBranch, Split, UserCog, Workflow, GitMerge, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { isMovableStep } from "@/lib/sequences/draft-edit";
import type { SequenceStepActionType } from "@/lib/sequences/types";
import { SequenceFlowContext, STEP_DRAG_MIME } from "./sequence-flow-bits";

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

/**
 * Per-enrolment runtime state used by the enrolment detail view to colour
 * the diagram :
 *   - "executed" : engine ran the step AND any task it created is done
 *   - "awaiting" : engine ran the step (created a task) BUT the rep hasn't
 *                  closed the task yet → the sequence is logically blocked
 *                  here, even though the engine cursor has already advanced
 *   - "current"  : engine cursor parked on the step, waiting to run next
 * Steps with no entry are pending (default neutral style).
 */
export type SequenceStepRunState = "executed" | "awaiting" | "current";

export type SequenceStepNodeData = {
  actionType: SequenceStepActionType;
  typeLabel: string;
  summary: string;
  conditionBadge?: string | null;
  isEntry: boolean;
  runState?: SequenceStepRunState;
};

/**
 * Custom React Flow node for one sequence step. Top handle = incoming, bottom
 * handle = outgoing (default). The node is read-as-card ; editing happens in
 * the side panel when selected.
 */
export function SequenceStepNode({ id, data }: NodeProps) {
  const d = data as unknown as SequenceStepNodeData;
  const Icon = ICONS[d.actionType] ?? Mail;
  const ctx = useContext(SequenceFlowContext);
  const draggable = !ctx.readOnly && isMovableStep(d.actionType);
  const selected = ctx.selectedId === id;

  return (
    <div
      draggable={draggable}
      onDragStart={
        draggable
          ? (e) => {
              e.dataTransfer.setData(STEP_DRAG_MIME, id);
              e.dataTransfer.effectAllowed = "move";
              // Translucent drag preview (a small chip) so the drop targets
              // behind the cursor stay visible.
              const ghost = document.createElement("div");
              ghost.textContent = d.typeLabel;
              ghost.style.cssText =
                "position:absolute;top:-1000px;left:-1000px;padding:4px 10px;border-radius:8px;background:rgba(15,23,42,0.55);color:#fff;font-size:12px;font-weight:600;white-space:nowrap;";
              document.body.appendChild(ghost);
              e.dataTransfer.setDragImage(ghost, 12, 12);
              setTimeout(() => ghost.remove(), 0);
              ctx.onDragStateChange?.(true);
            }
          : undefined
      }
      onDragEnd={draggable ? () => ctx.onDragStateChange?.(false) : undefined}
      title={draggable ? ctx.dragHint : undefined}
      className={cn(
        "w-[260px] rounded-lg border bg-card px-3 py-2.5 shadow-sm transition-colors",
        // `runState` takes precedence over the editor `selected` state because
        // it's only set in the enrolment detail view (where there is no
        // selection). Executed = green, awaiting (task not done) = violet,
        // current (cursor parked here) = red, pending = default.
        d.runState === "executed"
          ? "border-emerald-500 bg-emerald-50/50 ring-1 ring-emerald-500/30"
          : d.runState === "awaiting"
            ? "border-violet-500 bg-violet-50/40 ring-1 ring-violet-500/30"
            : d.runState === "current"
              ? "border-rose-500 bg-rose-50/40 ring-1 ring-rose-500/30"
              : selected
                ? "border-brand-teal ring-1 ring-brand-teal/30"
                : "border-border",
        draggable && "nodrag nopan cursor-grab active:cursor-grabbing",
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground/40" />
      <div className="flex items-start gap-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-foreground">{d.typeLabel}</span>
            {d.isEntry && (
              <span className="text-[10px] uppercase tracking-wide text-brand-teal">start</span>
            )}
          </div>
          {d.summary && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{d.summary}</p>
          )}
          {d.conditionBadge && (
            <span className="mt-1 inline-block rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {d.conditionBadge}
            </span>
          )}
        </div>
        {draggable && (
          // Visual cue only — the whole card is the drag surface.
          <GripVertical className="-mr-1 h-4 w-4 shrink-0 text-muted-foreground/40" aria-hidden />
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-brand-teal" />
    </div>
  );
}

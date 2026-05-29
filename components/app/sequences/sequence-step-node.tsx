"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Mail, Phone, Send, Clock, GitBranch, Split, UserCog, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SequenceStepActionType } from "@/lib/sequences/types";

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

export type SequenceStepNodeData = {
  actionType: SequenceStepActionType;
  typeLabel: string;
  summary: string;
  conditionBadge?: string | null;
  isEntry: boolean;
};

/**
 * Custom React Flow node for one sequence step. Top handle = incoming, bottom
 * handle = outgoing (default). The node is read-as-card ; editing happens in
 * the side panel when selected.
 */
export function SequenceStepNode({ data, selected }: NodeProps) {
  const d = data as unknown as SequenceStepNodeData;
  const Icon = ICONS[d.actionType] ?? Mail;

  return (
    <div
      className={cn(
        "w-[260px] rounded-lg border bg-card px-3 py-2.5 shadow-sm transition-colors",
        selected ? "border-brand-teal ring-1 ring-brand-teal/30" : "border-border",
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
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{d.summary}</p>
          {d.conditionBadge && (
            <span className="mt-1 inline-block rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {d.conditionBadge}
            </span>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-brand-teal" />
    </div>
  );
}

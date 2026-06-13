"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  MoreHorizontal, Pencil, Trash2, Circle, Clock, CheckCircle2,
  MessageSquarePlus, Sparkles, Send, Hand, Bot, RotateCw,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TaskInteractionDialog } from "@/components/app/task-interaction-dialog";
import { GenerateMessageDialog } from "@/components/app/generate-message-dialog";
import { SendDefinedMessageDialog } from "@/components/app/send-defined-message-dialog";
import { updateTaskStatusAction, deleteTaskAction, takeOverAgentTaskAction, retryAgentTaskAction } from "@/lib/actions/tasks";
import type { BrandBriefStatus } from "@/db/queries/brand";
import type { ChannelIntent, MessageLocale } from "@/lib/messages/types";

type TaskStatus = "pending" | "in_progress" | "completed";

const STATUS_CONFIG: Record<TaskStatus, { Icon: React.ElementType; className: string }> = {
  pending:     { Icon: Circle,       className: "text-slate-400" },
  in_progress: { Icon: Clock,        className: "text-blue-500" },
  completed:   { Icon: CheckCircle2, className: "text-emerald-500" },
};

/**
 * Optional dialog props for the AI generation surface. Provided only when the
 * task has a contact AND its type is message-eligible (email / linkedin /
 * follow_up). Computed server-side and threaded through TaskRow.
 */
export type TaskGenerateContext = {
  contactDisplayName: string;
  companyDisplayName: string;
  // Nullable for generic contacts (info@…).
  contactFirstName: string | null;
  contactLastName: string | null;
  contactJobTitle: string | null;
  defaultChannelIntent: ChannelIntent;
  defaultLocale: MessageLocale;
  preferredLocaleHint: string;
  detectedSignal: { type: string; daysAgo: number; isFresh: boolean } | null;
  brandBriefStatus: BrandBriefStatus;
  gmail: { connected: boolean; address: string | null; provider?: "gmail" | "outlook" | null };
  /**
   * Sprint 12 — when set, the task comes from a sequence and the dialog
   * shows the "message context scope" selector. The `resolvedScope` is
   * the effective default (sequence + step + dialog), pre-selected in
   * the picker so the sale sees what'll be used and can override it for
   * this generation.
   */
  sequenceContext?: {
    sequenceName: string;
    resolvedScope: "sequence" | "all";
  };
  /**
   * Sprint 12 phase 3 — when the task comes from a sequence step in
   * `defined` mode, we open `SendDefinedMessageDialog` (renders the
   * step's template) instead of the AI generation dialog. `null` (or
   * "ai") falls through to the AI dialog.
   */
  sourceStepMode?: "ai" | "defined" | null;
};

export function TaskRowActions({
  taskId,
  currentStatus,
  companyId,
  companyName,
  contactId,
  generate,
  /**
   * Sprint 12 phase 4 — when true, this task is sitting in the agent
   * auto-execution pipeline (`auto_execution_status = "pending"`).
   * The menu collapses to a single "Take over" item that clears the
   * flag so the sale handles it manually.
   */
  isAgentPending = false,
  isAgentFailed = false,
  labels,
}: {
  taskId: string;
  currentStatus: TaskStatus;
  companyId?: string | null;
  companyName?: string | null;
  contactId?: string | null;
  /** Present iff the task is message-eligible and has a contact. */
  generate?: TaskGenerateContext;
  isAgentPending?: boolean;
  /** Sprint 14 — true when `auto_execution_status === "failed"`. Adds a
   *  "Retry agent" item at the top of the dropdown so the user can
   *  re-launch the agent without having to take over first. */
  isAgentFailed?: boolean;
  labels: {
    statusSection: string;
    pending: string;
    inProgress: string;
    completed: string;
    logInteraction: string;
    generateMessage: string;
    sendDefinedMessage: string;
    edit: string;
    delete: string;
    takeOverAgent: string;
    retryAgent: string;
  };
}) {
  const router = useRouter();
  const [interactionOpen, setInteractionOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  // Sprint 12 phase 3 — when the task comes from a defined-mode step,
  // the menu offers BOTH "Generate a message" (AI dialog) and "Send the
  // defined message" (template dialog). Two open states, two dialogs.
  const [sendDefinedOpen, setSendDefinedOpen] = useState(false);

  async function changeStatus(status: TaskStatus) {
    const fd = new FormData();
    fd.append("taskId", taskId);
    fd.append("status", status);
    await updateTaskStatusAction(fd);
    router.refresh();
  }

  async function handleDelete() {
    const fd = new FormData();
    fd.append("taskId", taskId);
    await deleteTaskAction(fd);
    router.refresh();
  }

  async function handleTakeOver() {
    const fd = new FormData();
    fd.append("taskId", taskId);
    await takeOverAgentTaskAction(fd);
    router.refresh();
  }

  async function handleRetryAgent() {
    const fd = new FormData();
    fd.append("taskId", taskId);
    await retryAgentTaskAction(fd);
    router.refresh();
  }

  const statusLabels: Record<TaskStatus, string> = {
    pending: labels.pending,
    in_progress: labels.inProgress,
    completed: labels.completed,
  };

  return (
    <>
      {companyId && companyName && (
        <TaskInteractionDialog
          open={interactionOpen}
          onOpenChange={setInteractionOpen}
          taskId={taskId}
          companyId={companyId}
          companyName={companyName}
          contactId={contactId}
        />
      )}

      {/* AI generation dialog — always available when the task is
          message-eligible, regardless of the source step's mode. */}
      {generate && companyId && contactId && (
        <GenerateMessageDialog
          open={generateOpen}
          onOpenChange={setGenerateOpen}
          mode="task"
          taskId={taskId}
          contactId={contactId}
          companyId={companyId}
          contactDisplayName={generate.contactDisplayName}
          companyDisplayName={generate.companyDisplayName}
          annotationContact={{
            firstName: generate.contactFirstName,
            lastName: generate.contactLastName,
            jobTitle: generate.contactJobTitle,
          }}
          defaultChannelIntent={generate.defaultChannelIntent}
          defaultLocale={generate.defaultLocale}
          preferredLocaleHint={generate.preferredLocaleHint}
          detectedSignal={generate.detectedSignal}
          brandBriefStatus={generate.brandBriefStatus}
          gmail={generate.gmail}
          sequenceContext={generate.sequenceContext}
        />
      )}

      {/* Defined-template send dialog — only mounted when the source
          step is in `defined` mode, AND offered alongside (not instead
          of) the AI dialog. The sale picks. */}
      {generate && companyId && contactId && generate.sourceStepMode === "defined" && (
        <SendDefinedMessageDialog
          open={sendDefinedOpen}
          onOpenChange={setSendDefinedOpen}
          taskId={taskId}
          gmail={generate.gmail}
        />
      )}

      <DropdownMenu>
        <DropdownMenuTrigger className="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors outline-none">
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {/* Sprint 12 phase 4 — agent-pending tasks collapse to a single
              "Take over" action. Status changes, generate-message and
              other operations don't make sense while the system owns
              the task ; if the sale wants to act, they take over first. */}
          {isAgentPending ? (
            <DropdownMenuItem className="gap-2 cursor-pointer" onClick={handleTakeOver}>
              <Hand className="h-3.5 w-3.5 text-sky-600" />
              {labels.takeOverAgent}
            </DropdownMenuItem>
          ) : (
            <>
          {/* Sprint 14 — failed agent : surface "Retry agent" at the top,
              followed by the regular action items so the user can also
              fall back to manual handling without taking over first. */}
          {isAgentFailed && (
            <>
              <DropdownMenuItem className="gap-2 cursor-pointer" onClick={handleRetryAgent}>
                <RotateCw className="h-3.5 w-3.5 text-sky-600" />
                {labels.retryAgent}
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-2 cursor-pointer" onClick={handleTakeOver}>
                <Hand className="h-3.5 w-3.5 text-sky-600" />
                {labels.takeOverAgent}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            {labels.statusSection}
          </div>

          {(["pending", "in_progress", "completed"] as TaskStatus[]).map((s) => {
            const { Icon, className } = STATUS_CONFIG[s];
            const isActive = s === currentStatus;
            return (
              <DropdownMenuItem
                key={s}
                disabled={isActive}
                className="gap-2 cursor-pointer"
                onClick={() => changeStatus(s)}
              >
                <Icon className={`h-3.5 w-3.5 ${className}`} />
                <span className={isActive ? "font-medium" : ""}>{statusLabels[s]}</span>
                {isActive && <span className="ml-auto text-[10px] text-muted-foreground">✓</span>}
              </DropdownMenuItem>
            );
          })}

          <DropdownMenuSeparator />

          {generate && (
            <DropdownMenuItem
              className="gap-2 cursor-pointer"
              onClick={() => setGenerateOpen(true)}
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
              {labels.generateMessage}
            </DropdownMenuItem>
          )}

          {generate && generate.sourceStepMode === "defined" && (
            <DropdownMenuItem
              className="gap-2 cursor-pointer"
              onClick={() => setSendDefinedOpen(true)}
            >
              <Send className="h-3.5 w-3.5 text-sky-500" />
              {labels.sendDefinedMessage}
            </DropdownMenuItem>
          )}

          {companyId && companyName && (
            <DropdownMenuItem
              className="gap-2 cursor-pointer"
              onClick={() => setInteractionOpen(true)}
            >
              <MessageSquarePlus className="h-3.5 w-3.5 text-brand-teal" />
              {labels.logInteraction}
            </DropdownMenuItem>
          )}

          <DropdownMenuItem
            className="gap-2 cursor-pointer"
            onClick={() => router.push(`/tasks/${taskId}/edit`)}
          >
            <Pencil className="h-3.5 w-3.5" />
            {labels.edit}
          </DropdownMenuItem>

          <DropdownMenuItem
            className="gap-2 cursor-pointer text-red-600 focus:text-red-600"
            onClick={handleDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {labels.delete}
          </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

// Re-exported for callers that want to render the agent badge inline
// (e.g. the task list using the same Bot icon as the menu's headline).
export { Bot as AgentIcon };

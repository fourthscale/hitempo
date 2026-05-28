"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Circle, Clock, CheckCircle2, MessageSquarePlus, Sparkles, Pencil, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TaskInteractionDialog } from "@/components/app/task-interaction-dialog";
import { GenerateMessageDialog } from "@/components/app/generate-message-dialog";
import { updateTaskStatusAction, deleteTaskAction } from "@/lib/actions/tasks";
import { cn } from "@/lib/utils";
import type { TaskGenerateContext } from "@/components/app/task-row-actions";

type TaskStatus = "pending" | "in_progress" | "completed";

const STATUS_OPTIONS: { value: TaskStatus; Icon: React.ElementType; iconClass: string }[] = [
  { value: "pending",     Icon: Circle,       iconClass: "text-slate-400" },
  { value: "in_progress", Icon: Clock,        iconClass: "text-blue-500" },
  { value: "completed",   Icon: CheckCircle2, iconClass: "text-emerald-500" },
];

export function TaskDetailActions({
  taskId,
  currentStatus,
  companyId,
  companyName,
  contactId,
  generate,
  labels,
}: {
  taskId: string;
  currentStatus: TaskStatus;
  companyId?: string | null;
  companyName?: string | null;
  contactId?: string | null;
  generate?: TaskGenerateContext;
  labels: {
    statusSection: string;
    pending: string;
    inProgress: string;
    completed: string;
    logInteraction: string;
    generateMessage: string;
    edit: string;
    delete: string;
    deleteConfirm: string;
  };
}) {
  const router = useRouter();
  const [interactionOpen, setInteractionOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);

  async function changeStatus(status: TaskStatus) {
    const fd = new FormData();
    fd.append("taskId", taskId);
    fd.append("status", status);
    await updateTaskStatusAction(fd);
    router.refresh();
  }

  async function handleDelete() {
    if (!window.confirm(labels.deleteConfirm)) return;
    const fd = new FormData();
    fd.append("taskId", taskId);
    await deleteTaskAction(fd);
    router.push("/tasks");
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
        />
      )}

      <div className="space-y-3">
        {/* Inline status buttons */}
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            {labels.statusSection}
          </p>
          <div className="flex flex-col gap-1.5">
            {STATUS_OPTIONS.map(({ value, Icon, iconClass }) => {
              const isActive = value === currentStatus;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => !isActive && changeStatus(value)}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors text-left",
                    isActive
                      ? "bg-secondary font-medium text-foreground cursor-default"
                      : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground cursor-pointer",
                  )}
                >
                  <Icon className={cn("h-4 w-4 shrink-0", iconClass)} />
                  {statusLabels[value]}
                  {isActive && <CheckCircle2 className="h-3 w-3 ml-auto text-muted-foreground" />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="border-t border-border pt-3 flex flex-col gap-1.5">
          {generate && (
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={() => setGenerateOpen(true)}
            >
              <Sparkles className="h-4 w-4 text-amber-500" />
              {labels.generateMessage}
            </Button>
          )}

          {companyId && companyName && (
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={() => setInteractionOpen(true)}
            >
              <MessageSquarePlus className="h-4 w-4 text-brand-teal" />
              {labels.logInteraction}
            </Button>
          )}

          <Link href={`/tasks/${taskId}/edit`}>
            <Button variant="outline" size="sm" className="w-full justify-start gap-2">
              <Pencil className="h-4 w-4" />
              {labels.edit}
            </Button>
          </Link>

          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2 text-red-600 hover:text-red-600 hover:bg-red-50"
            onClick={handleDelete}
          >
            <Trash2 className="h-4 w-4" />
            {labels.delete}
          </Button>
        </div>
      </div>
    </>
  );
}

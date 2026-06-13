"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Bot, Mail, Phone, MapPin, MessageSquare, Search, MoreHorizontal } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { updateTaskStatusAction } from "@/lib/actions/tasks";
import { resolveContactDisplayName } from "@/lib/contacts/contact-kind";

/**
 * Kanban board for /tasks. Three columns (pending / in_progress / completed),
 * drag-and-drop status changes via HTML5 native API (no extra dependency —
 * the sequence editor uses the same primitive successfully).
 *
 * Agent-pipeline tasks (`autoExecutionStatus = "pending"`) are rendered with
 * a lock-style cursor and a Bot badge ; they are NOT draggable because the
 * Inngest handler owns them. Failed agent tasks ARE draggable so the user
 * can shove them through the workflow after a manual take-over.
 *
 * The drop handler is optimistic : we move the card locally first, then
 * call the server action. On failure we revert + router.refresh().
 */
export type KanbanTask = {
  id: string;
  title: string;
  type: string;
  status: "pending" | "in_progress" | "completed";
  priority: string | null;
  autoExecutionStatus: "pending" | "succeeded" | "failed" | null;
  autoExecutionFailureKind: string | null;
  company: { id: string; name: string } | null;
  contact: {
    id: string;
    kind: "person" | "generic";
    firstName: string | null;
    lastName: string | null;
    jobTitle: string | null;
  } | null;
  assigneeId: string | null;
};

type KanbanColumnKey = "pending" | "in_progress" | "completed";

const TYPE_ICON: Record<string, typeof Mail> = {
  email: Mail,
  linkedin: MessageSquare,
  phone: Phone,
  visit: MapPin,
  research: Search,
  other: MoreHorizontal,
};

const PRIORITY_BADGE: Record<string, string> = {
  urgent: "bg-rose-100 text-rose-700",
  high: "bg-amber-100 text-amber-700",
  medium: "bg-sky-100 text-sky-700",
  low: "bg-slate-100 text-slate-600",
};

export function TasksKanban({
  tasks,
  memberMap,
  currentUserId,
}: {
  tasks: KanbanTask[];
  memberMap: Record<string, string>;
  currentUserId: string;
}) {
  const t = useTranslations("pages.tasks");
  const tType = useTranslations("taskType");
  const router = useRouter();

  // Track only the optimistic overrides : taskId → new status. The
  // visible buckets are derived from (server tasks + pendingMoves) each
  // render, so no mirror-state sync is needed when the server hands us
  // a new task set after router.refresh. On a successful refresh the
  // server status matches our optimistic one ; we clear the override
  // for that id. On failure we revert by clearing too.
  const [pendingMoves, setPendingMoves] = useState<Map<string, KanbanColumnKey>>(
    () => new Map(),
  );

  const byStatus = useMemo<Record<KanbanColumnKey, KanbanTask[]>>(() => {
    const buckets: Record<KanbanColumnKey, KanbanTask[]> = {
      pending: [],
      in_progress: [],
      completed: [],
    };
    for (const task of tasks) {
      const override = pendingMoves.get(task.id);
      const effective: KanbanColumnKey = override ?? task.status;
      buckets[effective].push(override ? { ...task, status: override } : task);
    }
    return buckets;
  }, [tasks, pendingMoves]);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverColumn, setHoverColumn] = useState<KanbanColumnKey | null>(null);

  async function handleDrop(target: KanbanColumnKey, taskId: string) {
    setDraggingId(null);
    setHoverColumn(null);

    // Resolve the current effective status (server status overridden
    // by any in-flight optimistic move). If the task isn't in our
    // current set, bail — the next router.refresh will reconcile.
    const serverTask = tasks.find((task) => task.id === taskId);
    if (!serverTask) return;
    const currentStatus: KanbanColumnKey =
      pendingMoves.get(taskId) ?? serverTask.status;
    if (currentStatus === target) return;

    // Apply the optimistic override.
    setPendingMoves((prev) => {
      const next = new Map(prev);
      next.set(taskId, target);
      return next;
    });

    const fd = new FormData();
    fd.append("taskId", taskId);
    fd.append("status", target);
    try {
      await updateTaskStatusAction(fd);
      // Re-pull from server to refresh secondary state (sidebar counters,
      // task list page subtitles, etc.). Then clear the override : the
      // next render reads the new server status directly.
      router.refresh();
    } catch (err) {
      console.error("[TasksKanban] updateTaskStatus failed", err);
    } finally {
      // Always clear the override at the end — either the server now
      // matches us (success) or we want to fall back to the server
      // status (failure). The override only exists to bridge the
      // network round-trip.
      setPendingMoves((prev) => {
        const next = new Map(prev);
        next.delete(taskId);
        return next;
      });
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {(["pending", "in_progress", "completed"] as const).map((column) => (
        <KanbanColumn
          key={column}
          column={column}
          title={t(`kanban.column${
            column === "pending" ? "Pending" :
            column === "in_progress" ? "InProgress" :
            "Completed"
          }` as Parameters<typeof t>[0])}
          tasks={byStatus[column]}
          isHover={hoverColumn === column}
          onDragOver={(event) => {
            // Allow drop only when we have a draggable card in-flight.
            // Calling preventDefault is what marks the target as a valid
            // drop zone for the HTML5 API.
            if (!draggingId) return;
            event.preventDefault();
            if (hoverColumn !== column) setHoverColumn(column);
          }}
          onDragLeave={() => {
            if (hoverColumn === column) setHoverColumn(null);
          }}
          onDrop={(event) => {
            event.preventDefault();
            const id = event.dataTransfer.getData("text/plain");
            if (id) void handleDrop(column, id);
          }}
        >
          {byStatus[column].map((task) => {
            const Icon = TYPE_ICON[task.type] ?? MoreHorizontal;
            const isAgentLocked = task.autoExecutionStatus === "pending";
            const isAgentFailed = task.autoExecutionStatus === "failed";
            const draggable = !isAgentLocked;
            return (
              <li
                key={task.id}
                draggable={draggable}
                onDragStart={
                  draggable
                    ? (event) => {
                        event.dataTransfer.setData("text/plain", task.id);
                        event.dataTransfer.effectAllowed = "move";
                        setDraggingId(task.id);
                      }
                    : undefined
                }
                onDragEnd={draggable ? () => setDraggingId(null) : undefined}
                title={isAgentLocked ? t("kanban.agentLocked") : undefined}
                className={cn(
                  "rounded-md border border-border bg-card px-3 py-2.5 shadow-sm transition-opacity",
                  draggable && "cursor-grab active:cursor-grabbing hover:border-brand-teal/60",
                  !draggable && "opacity-90",
                  draggingId === task.id && "opacity-40",
                )}
              >
                <div className="flex items-start gap-2.5">
                  <div className="h-7 w-7 shrink-0 rounded-full bg-secondary flex items-center justify-center">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <Link
                        href={`/tasks/${task.id}`}
                        className="text-sm font-medium text-foreground hover:text-brand-teal truncate"
                      >
                        {tType(task.type as Parameters<typeof tType>[0])} · {task.title}
                      </Link>
                    </div>
                    {task.company && (
                      <div className="text-xs text-muted-foreground truncate">
                        {task.company.name}
                        {task.contact && ` — ${resolveContactDisplayName(task.contact)}`}
                      </div>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {task.priority && task.priority !== "medium" && (
                        <span className={cn(
                          "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium",
                          PRIORITY_BADGE[task.priority] ?? PRIORITY_BADGE.medium,
                        )}>
                          {task.priority}
                        </span>
                      )}
                      {(isAgentLocked || isAgentFailed) && (
                        <span className={cn(
                          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium",
                          isAgentFailed
                            ? "bg-rose-100 text-rose-700"
                            : "bg-sky-100 text-sky-700",
                        )}>
                          <Bot className="h-2.5 w-2.5" />
                          {isAgentFailed ? "agent failed" : "agent"}
                        </span>
                      )}
                      {task.assigneeId && task.assigneeId !== currentUserId && memberMap[task.assigneeId] && (
                        <span className="text-[10px] text-muted-foreground">
                          {memberMap[task.assigneeId]}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </KanbanColumn>
      ))}
    </div>
  );
}

function KanbanColumn({
  column,
  title,
  tasks,
  isHover,
  children,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  column: KanbanColumnKey;
  title: string;
  tasks: KanbanTask[];
  isHover: boolean;
  children: React.ReactNode;
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
}) {
  const t = useTranslations("pages.tasks");
  return (
    <Card
      className={cn(
        "p-3 transition-colors min-h-[200px]",
        isHover && "border-brand-teal bg-brand-teal/5",
      )}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      data-column={column}
    >
      <div className="flex items-center justify-between mb-3 px-1">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {title}
          <span className="ml-1.5 font-normal">({tasks.length})</span>
        </h3>
      </div>
      <ul className="space-y-2">
        {tasks.length === 0 ? (
          <li className="text-center text-xs text-muted-foreground py-6 select-none">
            {t("kanban.dropHint")}
          </li>
        ) : (
          children
        )}
      </ul>
    </Card>
  );
}

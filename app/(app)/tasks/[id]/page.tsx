import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, getLocale } from "next-intl/server";
import {
  Mail, Phone, MapPin, RefreshCcw, Search, Calendar, User, AlertTriangle, Workflow,
} from "lucide-react";
import { getActiveOrg } from "@/lib/auth/context";
import { GmailCredentialsServiceFactory } from "@/lib/gmail/gmail-credentials-service-factory";
import { getTaskDetail } from "@/db/queries/tasks";
import { getInteractionsByTask } from "@/db/queries/interactions";
import { getAttachmentsByMessageIds } from "@/db/queries/message-attachments";
import { getOrgMembersWithNames } from "@/db/queries/members";
import { getBrandBriefStatus } from "@/db/queries/brand";
import { TaskDetailActions } from "@/components/app/task-detail-actions";
import {
  InteractionsTimeline,
  type InteractionsTimelineLabels,
} from "@/components/app/interactions-timeline";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { scoreGrade, scoreBadgeClasses } from "@/lib/scoring/grade";
import {
  getMessageDefaultsFromTask,
  getMessageDefaultLocale,
  getDetectedSignalProp,
} from "@/lib/messages/task-defaults";
import { resolveContactDisplayName } from "@/lib/contacts/contact-kind";
import type { TaskGenerateContext } from "@/components/app/task-row-actions";

function taskTypeIcon(type: string) {
  switch (type) {
    case "email":     return { Icon: Mail,       bg: "bg-blue-100 text-blue-600" };
    case "follow_up": return { Icon: RefreshCcw, bg: "bg-amber-100 text-amber-600" };
    case "phone":     return { Icon: Phone,      bg: "bg-violet-100 text-violet-600" };
    case "visit":     return { Icon: MapPin,     bg: "bg-lime-100 text-lime-700" };
    case "linkedin":  return { Icon: Mail,       bg: "bg-sky-100 text-sky-600" };
    case "meeting":   return { Icon: Calendar,   bg: "bg-emerald-100 text-emerald-600" };
    case "research":  return { Icon: Search,     bg: "bg-slate-100 text-slate-600" };
    default:          return { Icon: RefreshCcw, bg: "bg-slate-100 text-slate-500" };
  }
}

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { activeOrganization, user } = await getActiveOrg();
  const orgId = activeOrganization.id;
  const gmailStatus = await GmailCredentialsServiceFactory.getInstance().getConnectionStatus(user.id);
  const locale = await getLocale();

  const [task, taskInteractions, members, brandBriefStatus] = await Promise.all([
    getTaskDetail(orgId, id),
    getInteractionsByTask(orgId, id),
    getOrgMembersWithNames(orgId),
    getBrandBriefStatus(orgId),
  ]);

  if (!task) notFound();

  // Bulk-fetch attachments for the messages referenced by these interactions
  // — same pattern as the contact page so the timeline can render file
  // links inline. Empty list = noop, getAttachmentsByMessageIds handles it.
  const messageIdsInTimeline = Array.from(
    new Set(
      taskInteractions
        .map((i) => i.messageId)
        .filter((mid): mid is string => mid !== null),
    ),
  );
  const attachmentsByMessageId = await getAttachmentsByMessageIds(orgId, messageIdsInTimeline);

  const t = await getTranslations("pages.tasks");
  const tTaskType = await getTranslations("taskType");
  const tPriority = await getTranslations("taskPriority");
  const tInteractions = await getTranslations("pages.interactions");
  const tInteractionType = await getTranslations("interactionType");
  const tInteractionChannel = await getTranslations("interactionChannel");
  const tInteractionOutcome = await getTranslations("interactionOutcome");
  const tInteractionStatus = await getTranslations("interactionStatus");
  const tMessages = await getTranslations("pages.messages");

  const memberMap = Object.fromEntries(members.map((m) => [m.userId, m.displayName]));
  const assigneeName = task.assigneeId
    ? task.assigneeId === user.id
      ? t("assigneeMe")
      : (memberMap[task.assigneeId] ?? "—")
    : null;

  const { Icon, bg } = taskTypeIcon(task.type);
  const typeLabel = tTaskType(task.type as Parameters<typeof tTaskType>[0]);

  const safeStatus = (
    ["pending", "in_progress", "completed"].includes(task.status) ? task.status : "pending"
  ) as "pending" | "in_progress" | "completed";

  const safePriority = (
    ["low", "medium", "high", "urgent"].includes(task.priority ?? "") ? task.priority : "medium"
  ) as "low" | "medium" | "high" | "urgent";

  const statusBadge: Record<typeof safeStatus, { label: string; className: string }> = {
    pending:     { label: t("actions.pending"),    className: "bg-slate-100 text-slate-600" },
    in_progress: { label: t("actions.inProgress"), className: "bg-blue-100 text-blue-700" },
    completed:   { label: t("actions.completed"),  className: "bg-emerald-100 text-emerald-700" },
  };

  const priorityBadge: Record<typeof safePriority, string> = {
    low:    "bg-slate-100 text-slate-500",
    medium: "bg-blue-100 text-blue-600",
    high:   "bg-amber-100 text-amber-700",
    urgent: "bg-red-100 text-red-700",
  };

  const grade = scoreGrade(task.company?.score);
  const now = new Date();
  const isOverdue = safeStatus !== "completed" && task.dueAt != null && task.dueAt < now;

  // Generate message context (same logic as task list)
  const messageDefaults = task.contact
    ? getMessageDefaultsFromTask({ type: task.type, contactId: task.contact.id })
    : null;
  const generateCtx: TaskGenerateContext | undefined =
    messageDefaults && task.contact && task.company
      ? {
          contactDisplayName: resolveContactDisplayName(task.contact),
          companyDisplayName: task.company.name,
          contactFirstName: task.contact.firstName,
          contactLastName: task.contact.lastName,
          contactJobTitle: task.contact.jobTitle,
          defaultChannelIntent: messageDefaults.channelIntent,
          defaultLocale: getMessageDefaultLocale(task.contact.preferredLanguage),
          preferredLocaleHint: tMessages("fields.languageHint", {
            contact: resolveContactDisplayName(task.contact),
          }),
          detectedSignal: getDetectedSignalProp(
            task.company.signalType,
            task.company.signalDetectedAt,
          ),
          brandBriefStatus,
          gmail: gmailStatus,
          sequenceContext: task.sequenceEnrolment?.sequence
            ? {
                sequenceName: task.sequenceEnrolment.sequence.name,
                resolvedScope:
                  task.sequenceEnrolment.sequence.messageContextScope === "all"
                    ? ("all" as const)
                    : ("sequence" as const),
              }
            : undefined,
          // Sprint 12 phase 3 — defined-mode steps open SendDefinedMessageDialog.
          sourceStepMode: task.sourceStepMode ?? null,
        }
      : undefined;

  const outcomeLabels = {
    no_response:     tInteractionOutcome("no_response"),
    positive_reply:  tInteractionOutcome("positive_reply"),
    negative_reply:  tInteractionOutcome("negative_reply"),
    out_of_office:   tInteractionOutcome("out_of_office"),
    wrong_contact:   tInteractionOutcome("wrong_contact"),
    rdv_scheduled:   tInteractionOutcome("rdv_scheduled"),
    opted_out:       tInteractionOutcome("opted_out"),
  };

  return (
    <div className="max-w-[1100px] mx-auto">
      {/* Breadcrumb */}
      <nav className="text-xs text-muted-foreground mb-4">
        <Link href="/tasks" className="hover:text-foreground">
          {t("breadcrumb")}
        </Link>
        {" / "}
        <span className="text-foreground truncate">{task.title}</span>
      </nav>

      {/* Page header */}
      <div className="flex items-start gap-4 mb-6">
        <div className={cn(
          "h-10 w-10 rounded-full flex items-center justify-center shrink-0 mt-0.5",
          bg,
        )}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-serif text-2xl md:text-3xl font-bold tracking-tight leading-tight">
            {typeLabel} · {task.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <span className={cn(
              "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
              statusBadge[safeStatus].className,
            )}>
              {statusBadge[safeStatus].label}
            </span>

            <span className={cn(
              "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
              priorityBadge[safePriority],
            )}>
              {tPriority(safePriority)}
            </span>

            {task.company?.score != null && grade && (
              <span className={cn(
                "inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium",
                scoreBadgeClasses(task.company.score),
              )}>
                {task.company.score} · {grade}
              </span>
            )}

            {isOverdue && (
              <span className="inline-flex items-center gap-1 text-xs text-brand-amber font-medium">
                <AlertTriangle className="h-3.5 w-3.5" />
                {t("groups.overdue")}
              </span>
            )}

            {task.sequenceEnrolment?.sequence && (
              <Link
                href={`/sequences/${task.sequenceEnrolment.sequence.id}/enrolments/${task.sequenceEnrolment.id}`}
                className="inline-flex items-center gap-1.5 rounded bg-brand-teal/10 px-2 py-0.5 text-xs font-medium text-brand-teal hover:bg-brand-teal/20"
              >
                <Workflow className="h-3.5 w-3.5" />
                {task.sequenceEnrolment.sequence.name}
                {task.sequenceEnrolment.sequence.steps.length > 0 &&
                  ` · ${t("sequenceStepBadge", {
                    // Show the step that created this task, not the
                    // enrolment cursor (which has already advanced).
                    current:
                      (task.sourceStepOrder ?? task.sequenceEnrolment.currentStepOrder) + 1,
                    total: task.sequenceEnrolment.sequence.steps.length,
                  })}`}
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">

        {/* Left: description + interactions */}
        <div className="flex-1 min-w-0 space-y-6">

          {/* Description */}
          {task.description && (
            <Card className="p-5">
              <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
                {t("detail.description")}
              </h2>
              <p className="text-sm whitespace-pre-wrap">{task.description}</p>
            </Card>
          )}

          {/* Interactions — same component as the contact page so the
              "Envoi" + "Reply" pair groups under the same row with a
              "↩ Répondu" badge on the outbound, attachments inline, and
              the grouped/list mode toggle. Single source of truth for
              the visual model. */}
          <Card className="p-5">
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-4">
              {t("detail.interactions")}
              {taskInteractions.length > 0 && (
                <span className="ml-1.5 font-normal normal-case tracking-normal">
                  ({taskInteractions.length})
                </span>
              )}
            </h2>

            <InteractionsTimeline
              locale={locale}
              interactions={taskInteractions.map((i) => ({
                id: i.id,
                type: i.type,
                channel: i.channel,
                outcome: i.outcome,
                status: i.status,
                summary: i.summary,
                occurredAt: i.occurredAt,
                messageId: i.messageId,
                attachments: i.messageId
                  ? (attachmentsByMessageId.get(i.messageId) ?? []).map((a) => ({
                      id: a.id,
                      filename: a.filename,
                      sizeBytes: a.sizeBytes,
                    }))
                  : undefined,
              }))}
              labels={
                {
                  modeGrouped: tInteractions("modeGrouped"),
                  modeList: tInteractions("modeList"),
                  emptyState: t("detail.noInteractions"),
                  statuses: {
                    sent: tInteractionStatus("sent"),
                    responded: tInteractionStatus("responded"),
                    no_answer: tInteractionStatus("no_answer"),
                    done: tInteractionStatus("done"),
                  },
                  outcomeMenu: {
                    outcomes: outcomeLabels,
                    setOutcome: tInteractions("setOutcome"),
                    clearOutcome: tInteractions("clearOutcome"),
                  },
                  typeLabels: {
                    first_contact: tInteractionType("first_contact"),
                    follow_up: tInteractionType("follow_up"),
                    call: tInteractionType("call"),
                    visit: tInteractionType("visit"),
                    linkedin: tInteractionType("linkedin"),
                    meeting: tInteractionType("meeting"),
                    demo: tInteractionType("demo"),
                    proposal_sent: tInteractionType("proposal_sent"),
                    note: tInteractionType("note"),
                    email_received: tInteractionType("email_received"),
                  },
                  channelLabels: {
                    email: tInteractionChannel("email"),
                    linkedin: tInteractionChannel("linkedin"),
                    phone: tInteractionChannel("phone"),
                    in_person: tInteractionChannel("in_person"),
                    video: tInteractionChannel("video"),
                    other: tInteractionChannel("other"),
                  },
                  replyHeader: tInteractions("replyHeader"),
                  attachments: {
                    sectionLabel: tInteractions("attachments.sectionLabel"),
                    downloadError: tInteractions("attachments.downloadError"),
                  },
                } satisfies InteractionsTimelineLabels
              }
            />
          </Card>
        </div>

        {/* Right: details + actions */}
        <div className="w-full lg:w-72 shrink-0 space-y-4">

          {/* Details card */}
          <Card className="p-5">
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-4">
              {t("detail.details")}
            </h2>
            <dl className="space-y-3 text-sm">

              {/* Due date */}
              <div className="flex items-start gap-2">
                <dt className="text-muted-foreground shrink-0 w-24">{t("detail.dueAt")}</dt>
                <dd className={cn(isOverdue ? "text-brand-amber font-medium" : "text-foreground")}>
                  {task.dueAt ? (
                    new Intl.DateTimeFormat(locale, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(task.dueAt)
                  ) : (
                    <span className="text-muted-foreground">{t("detail.noDueDate")}</span>
                  )}
                </dd>
              </div>

              {/* Assignee */}
              {assigneeName && (
                <div className="flex items-start gap-2">
                  <dt className="text-muted-foreground shrink-0 w-24">{t("detail.assignee")}</dt>
                  <dd className="flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    {assigneeName}
                  </dd>
                </div>
              )}

              {/* Company */}
              {task.company && (
                <div className="flex items-start gap-2">
                  <dt className="text-muted-foreground shrink-0 w-24">{t("detail.company")}</dt>
                  <dd>
                    <Link
                      href={`/companies/${task.company.id}`}
                      className="font-medium hover:text-brand-teal"
                    >
                      {task.company.name}
                    </Link>
                  </dd>
                </div>
              )}

              {/* Contact */}
              {task.contact && (
                <div className="flex items-start gap-2">
                  <dt className="text-muted-foreground shrink-0 w-24">{t("detail.contact")}</dt>
                  <dd>
                    <Link
                      href={`/contacts/${task.contact.id}`}
                      className="hover:text-brand-teal"
                    >
                      {resolveContactDisplayName(task.contact)}
                    </Link>
                    {task.contact.jobTitle && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {task.contact.jobTitle}
                      </p>
                    )}
                  </dd>
                </div>
              )}

              {/* Priority */}
              <div className="flex items-start gap-2">
                <dt className="text-muted-foreground shrink-0 w-24">{t("detail.priority")}</dt>
                <dd>{tPriority(safePriority)}</dd>
              </div>

              {/* Created */}
              <div className="flex items-start gap-2">
                <dt className="text-muted-foreground shrink-0 w-24">{t("detail.createdAt")}</dt>
                <dd className="text-muted-foreground">
                  {new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(task.createdAt)}
                </dd>
              </div>
            </dl>
          </Card>

          {/* Actions */}
          <Card className="p-5">
            <TaskDetailActions
              taskId={task.id}
              currentStatus={safeStatus}
              companyId={task.company?.id ?? null}
              companyName={task.company?.name ?? null}
              contactId={task.contact?.id ?? null}
              generate={generateCtx}
              labels={{
                statusSection: t("actions.statusSection"),
                pending: t("actions.pending"),
                inProgress: t("actions.inProgress"),
                completed: t("actions.completed"),
                logInteraction: t("actions.logInteraction"),
                generateMessage: tMessages("actions.fromTask"),
                edit: t("actions.edit"),
                delete: t("actions.delete"),
                deleteConfirm: t("detail.deleteConfirm"),
              }}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}

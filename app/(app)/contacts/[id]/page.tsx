import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, getLocale } from "next-intl/server";
import { Pencil, Trash2, Plus } from "lucide-react";
import { getActiveOrg } from "@/lib/auth/context";
import { GmailCredentialsServiceFactory } from "@/lib/gmail/gmail-credentials-service-factory";
import { getContactById } from "@/db/queries/contacts";
import { getInteractionsByContact } from "@/db/queries/interactions";
import { getAttachmentsByMessageIds } from "@/db/queries/message-attachments";
import { getTasksByContact } from "@/db/queries/tasks";
import { getBrandBriefStatus } from "@/db/queries/brand";
import { deleteContactAction } from "@/lib/actions/contacts";
import { logInteractionAction } from "@/lib/actions/interactions";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { LogInteractionForm } from "@/components/app/log-interaction-form";
import {
  InteractionsTimeline,
  type InteractionsTimelineLabels,
} from "@/components/app/interactions-timeline";
import { ContactGenerateMessageButton } from "@/components/app/contact-generate-message-button";
import {
  getMessageDefaultLocale,
  getDetectedSignalProp,
} from "@/lib/messages/task-defaults";
import { cn } from "@/lib/utils";

const INTERACTION_TYPES = [
  "first_contact", "follow_up", "call", "visit", "linkedin",
  "meeting", "demo", "proposal_sent", "note",
] as const;

const CHANNELS = ["email", "linkedin", "phone", "in_person", "video", "other"] as const;

const OUTCOMES = [
  "no_response", "positive_reply", "negative_reply", "out_of_office",
  "wrong_contact", "rdv_scheduled", "opted_out",
] as const;

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { activeOrganization, user } = await getActiveOrg();
  const orgId = activeOrganization.id;
  const gmailStatus = await GmailCredentialsServiceFactory.getInstance().getConnectionStatus(user.id);
  const contact = await getContactById(orgId, id);
  if (!contact) notFound();

  const [interactionHistory, contactTasks, brandBriefStatus] = await Promise.all([
    getInteractionsByContact(orgId, id),
    getTasksByContact(orgId, id),
    getBrandBriefStatus(orgId),
  ]);

  // Bulk-fetch attachments for all messages referenced by these interactions
  // in a single query, then dispatch into a Map for O(1) lookup when mapping
  // each row into the TimelineInteraction payload below.
  const messageIdsInTimeline = Array.from(
    new Set(
      interactionHistory
        .map((i) => i.messageId)
        .filter((id): id is string => id !== null),
    ),
  );
  const attachmentsByMessageId = await getAttachmentsByMessageIds(orgId, messageIdsInTimeline);

  const locale = await getLocale();
  const t = await getTranslations("pages.contacts");
  const tTasks = await getTranslations("pages.tasks");
  const tInteractions = await getTranslations("pages.interactions");
  const tInteractionType = await getTranslations("interactionType");
  const tInteractionChannel = await getTranslations("interactionChannel");
  const tInteractionOutcome = await getTranslations("interactionOutcome");
  const tInteractionStatus = await getTranslations("interactionStatus");
  const tTaskType = await getTranslations("taskType");
  const tTaskPriority = await getTranslations("taskPriority");
  const tContactRole = await getTranslations("contactRole");
  const tContactStatus = await getTranslations("contactStatus");
  const tMessages = await getTranslations("pages.messages");

  const interactionTypeOptions = INTERACTION_TYPES.map((v) => ({
    value: v,
    label: tInteractionType(v),
  }));
  const channelOptions = CHANNELS.map((v) => ({
    value: v,
    label: tInteractionChannel(v),
  }));
  const outcomeOptions = OUTCOMES.map((v) => ({
    value: v,
    label: tInteractionOutcome(v),
  }));

  return (
    <div className="max-w-[1000px] mx-auto">
      <PageHeader
        title={`${contact.firstName} ${contact.lastName}`}
        subtitle={
          <span>
            {contact.jobTitle ?? "—"}
            {contact.company && (
              <>
                {" · "}
                <Link href={`/companies/${contact.company.id}`} className="text-brand-teal hover:underline">
                  {contact.company.name}
                </Link>
              </>
            )}
            {contact.site && (
              <>
                {" · "}
                <span className="text-muted-foreground">{contact.site.name}</span>
              </>
            )}
          </span>
        }
        right={
          <div className="flex items-center gap-2">
            {contact.company && (
              <ContactGenerateMessageButton
                label={tMessages("actions.fromContact")}
                contactId={contact.id}
                companyId={contact.company.id}
                contactDisplayName={`${contact.firstName} ${contact.lastName}`}
                companyDisplayName={contact.company.name}
                annotationContact={{
                  firstName: contact.firstName,
                  lastName: contact.lastName,
                  jobTitle: contact.jobTitle,
                }}
                defaultChannelIntent={
                  interactionHistory.length === 0
                    ? "email-first_contact"
                    : "email-follow_up"
                }
                defaultLocale={getMessageDefaultLocale(contact.preferredLanguage)}
                preferredLocaleHint={tMessages("fields.languageHint", {
                  contact: `${contact.firstName} ${contact.lastName}`,
                })}
                detectedSignal={getDetectedSignalProp(
                  contact.company.signalType,
                  contact.company.signalDetectedAt,
                )}
                brandBriefStatus={brandBriefStatus}
                gmail={gmailStatus}
              />
            )}
            <Link href={`/contacts/${contact.id}/edit`}>
              <Button variant="outline" size="sm">
                <Pencil className="h-3.5 w-3.5 mr-1.5" />
                {t("edit")}
              </Button>
            </Link>
            <form action={deleteContactAction}>
              <input type="hidden" name="id" value={contact.id} />
              <SubmitButton variant="outline" size="sm" className="text-red-600 hover:bg-red-50">
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                {t("delete")}
              </SubmitButton>
            </form>
          </div>
        }
      />

      {/* Core info grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">{t("fields.email")}</div>
          <div className="text-sm break-all">{contact.email ?? "—"}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">{t("fields.phone")}</div>
          <div className="text-sm">{contact.phone ?? "—"}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">{t("fields.role")}</div>
          <div className="text-sm">
            {contact.role
              ? tContactRole(contact.role as Parameters<typeof tContactRole>[0])
              : "—"}
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">{t("fields.relevance")}</div>
          <div className="text-sm">{contact.relevance ? "★".repeat(contact.relevance) : "—"}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">{t("fields.status")}</div>
          <div className="text-sm">
            {tContactStatus(contact.status as Parameters<typeof tContactStatus>[0])}
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">{t("fields.preferredLanguage")}</div>
          <div className="text-sm">{contact.preferredLanguage}</div>
        </Card>
      </div>

      {contact.notes && (
        <Card className="p-5 mb-8">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">{t("fields.notes")}</div>
          <div className="text-sm whitespace-pre-wrap">{contact.notes}</div>
        </Card>
      )}

      {/* Tasks section */}
      <Card className="p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-serif text-lg font-bold">{tTasks("breadcrumb")}</h2>
          <Link
            href={`/tasks/new?contactId=${contact.id}${contact.company ? `&companyId=${contact.company.id}` : ""}`}
            className="inline-flex items-center gap-1 text-sm text-brand-teal hover:underline"
          >
            <Plus className="h-3.5 w-3.5" />
            {tTasks("newTask")}
          </Link>
        </div>

        {contactTasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tTasks("empty")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {contactTasks.map((task) => (
              <li key={task.id} className="py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/tasks/${task.id}`}
                    className="text-sm font-medium hover:underline"
                  >
                    {tTaskType(task.type as Parameters<typeof tTaskType>[0])} · {task.title}
                  </Link>
                  {task.dueAt && (
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(task.dueAt)}
                    </div>
                  )}
                </div>
                <span className={cn(
                  "text-xs px-1.5 py-0.5 rounded font-medium",
                  task.priority === "urgent" ? "bg-red-50 text-red-700" :
                  task.priority === "high" ? "bg-amber-50 text-amber-700" :
                  "bg-secondary text-muted-foreground",
                )}>
                  {tTaskPriority(task.priority as Parameters<typeof tTaskPriority>[0])}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Interactions section */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-serif text-lg font-bold">{tInteractions("title")}</h2>
          {contact.company && (
            <LogInteractionForm
              companyId={contact.company.id}
              companyName={contact.company.name}
              contactId={contact.id}
              action={logInteractionAction}
              labels={{
                logNew: tInteractions("logNew"),
                fields: {
                  type: tInteractions("fields.type"),
                  channel: tInteractions("fields.channel"),
                  outcome: tInteractions("fields.outcome"),
                  summary: tInteractions("fields.summary"),
                  occurredAt: tInteractions("fields.occurredAt"),
                  interestLevel: tInteractions("fields.interestLevel"),
                },
                submit: tInteractions("submit"),
                cancel: tInteractions("cancel"),
              }}
              interactionTypes={interactionTypeOptions}
              channels={channelOptions}
              outcomes={outcomeOptions}
            />
          )}
        </div>

        <InteractionsTimeline
          locale={locale}
          interactions={interactionHistory.map((i) => ({
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
              emptyState: tInteractions("empty"),
              statuses: {
                sent: tInteractionStatus("sent"),
                responded: tInteractionStatus("responded"),
                no_answer: tInteractionStatus("no_answer"),
                done: tInteractionStatus("done"),
              },
              outcomeMenu: {
                outcomes: {
                  no_response: tInteractionOutcome("no_response"),
                  positive_reply: tInteractionOutcome("positive_reply"),
                  negative_reply: tInteractionOutcome("negative_reply"),
                  out_of_office: tInteractionOutcome("out_of_office"),
                  wrong_contact: tInteractionOutcome("wrong_contact"),
                  rdv_scheduled: tInteractionOutcome("rdv_scheduled"),
                  opted_out: tInteractionOutcome("opted_out"),
                },
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
  );
}

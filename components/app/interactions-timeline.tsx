"use client";

import { useState, useMemo, useTransition } from "react";
import { CornerDownRight, List, FoldVertical, Reply, FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  InteractionOutcomeMenu,
  type InteractionOutcome,
} from "@/components/app/interaction-outcome-menu";
import { getAttachmentDownloadUrlAction } from "@/lib/actions/message-attachments";

/**
 * Minimal shape the timeline needs. Anything richer is for the parent's
 * benefit ; the timeline only consumes these fields.
 */
export type TimelineAttachment = {
  id: string;
  filename: string;
  sizeBytes: number;
};

export type TimelineInteraction = {
  id: string;
  type: string;
  channel: string;
  outcome: string | null;
  status: string | null;
  summary: string | null;
  occurredAt: Date | string;
  /** FK back to the originating `messages` row. Used to group an outbound
   *  with its `email_received` reply. */
  messageId: string | null;
  /** Attachments tied to the originating `messages` row (Gmail send). Empty
   *  for inbound or non-Gmail outbound rows. */
  attachments?: TimelineAttachment[];
};

export type InteractionsTimelineLabels = {
  modeGrouped: string;
  modeList: string;
  emptyState: string;
  statuses: { sent: string; responded: string; no_answer: string; done: string };
  outcomeMenu: {
    outcomes: Record<InteractionOutcome, string>;
    setOutcome: string;
    clearOutcome: string;
  };
  /** Pre-translated type label for each `interaction.type` we may encounter. */
  typeLabels: Record<string, string>;
  channelLabels: Record<string, string>;
  /** Short label rendered above the indented reply ("Réponse" / "Reply"). */
  replyHeader: string;
  /** Section heading + download error message for attachments. */
  attachments: {
    sectionLabel: string;
    downloadError: string;
  };
};

export function InteractionsTimeline({
  interactions,
  labels,
  locale,
}: {
  interactions: TimelineInteraction[];
  labels: InteractionsTimelineLabels;
  locale: string;
}) {
  const [mode, setMode] = useState<"grouped" | "list">("grouped");

  const formatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "short" }),
    [locale],
  );

  if (interactions.length === 0) {
    return <p className="text-sm text-muted-foreground">{labels.emptyState}</p>;
  }

  return (
    <div>
      {/* Switcher */}
      <div className="flex items-center gap-1 mb-3">
        <Button
          type="button"
          size="sm"
          variant={mode === "grouped" ? "default" : "outline"}
          onClick={() => setMode("grouped")}
        >
          <FoldVertical className="h-3.5 w-3.5 mr-1.5" />
          {labels.modeGrouped}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "list" ? "default" : "outline"}
          onClick={() => setMode("list")}
        >
          <List className="h-3.5 w-3.5 mr-1.5" />
          {labels.modeList}
        </Button>
      </div>

      {mode === "list" ? (
        (() => {
          // Pre-compute the set of outbound message ids that already
          // received a reply. In both modes, the outbound row should not
          // expose an outcome menu when its reply will carry the
          // qualification — same UX rule, factored out of the grouped
          // branch so "list" mode honors it too.
          const messageIdsWithReply = new Set<string>();
          for (const i of interactions) {
            if (i.type === "email_received" && i.messageId) {
              messageIdsWithReply.add(i.messageId);
            }
          }
          const isReplyQualifiedOutbound = (i: TimelineInteraction) =>
            i.type !== "email_received" &&
            i.messageId != null &&
            messageIdsWithReply.has(i.messageId);

          return (
            <ul className="divide-y divide-border">
              {sortByOccurredDesc(interactions).map((interaction) => (
                <li key={interaction.id} className="py-3">
                  <InteractionRow
                    interaction={interaction}
                    labels={labels}
                    formatter={formatter}
                    hideOutcomeMenu={isReplyQualifiedOutbound(interaction)}
                    primary
                  />
                </li>
              ))}
            </ul>
          );
        })()
      ) : (
        <ul className="divide-y divide-border">
          {groupAndSort(interactions).map((group) => (
            <li key={group.key} className="py-3">
              <InteractionRow
                interaction={group.primary}
                labels={labels}
                formatter={formatter}
                // Outcome menu is hidden on the outbound when a reply is
                // linked — the reply is where the qualification lives.
                hideOutcomeMenu={group.replies.length > 0}
                primary
              />
              {group.replies.length > 0 && (
                <ul className="mt-2 ml-6 pl-3 border-l border-border space-y-2">
                  {group.replies.map((reply) => (
                    <li key={reply.id} className="py-1">
                      <InteractionRow
                        interaction={reply}
                        labels={labels}
                        formatter={formatter}
                        hideOutcomeMenu={false}
                        primary={false}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function InteractionRow({
  interaction,
  labels,
  formatter,
  hideOutcomeMenu,
  primary,
}: {
  interaction: TimelineInteraction;
  labels: InteractionsTimelineLabels;
  formatter: Intl.DateTimeFormat;
  hideOutcomeMenu: boolean;
  primary: boolean;
}) {
  const typeLabel = labels.typeLabels[interaction.type] ?? interaction.type;
  const channelLabel = labels.channelLabels[interaction.channel] ?? interaction.channel;

  return (
    <div className="flex items-start gap-3">
      {!primary && (
        <CornerDownRight className="h-3.5 w-3.5 mt-1 text-muted-foreground shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-0.5">
          <span className="text-xs font-medium text-foreground">{typeLabel}</span>
          <span className="text-xs text-muted-foreground">· {channelLabel}</span>

          {/* Status badge — only for interactions that have one. */}
          {interaction.status && (
            <StatusBadge status={interaction.status} labels={labels.statuses} />
          )}

          {/* Outcome menu — hidden when a reply qualifies instead. */}
          {!hideOutcomeMenu && (
            <InteractionOutcomeMenu
              interactionId={interaction.id}
              current={(interaction.outcome ?? null) as InteractionOutcome | null}
              labels={{
                outcomes: labels.outcomeMenu.outcomes,
                setOutcome: labels.outcomeMenu.setOutcome,
                clearOutcome: labels.outcomeMenu.clearOutcome,
              }}
            />
          )}
        </div>
        {interaction.summary && (
          <p className="text-sm text-foreground mt-0.5 whitespace-pre-line">
            {interaction.summary}
          </p>
        )}
        {interaction.attachments && interaction.attachments.length > 0 && (
          <AttachmentsList
            attachments={interaction.attachments}
            labels={labels.attachments}
          />
        )}
      </div>
      <div className="text-xs text-muted-foreground shrink-0">
        {formatter.format(new Date(interaction.occurredAt))}
      </div>
    </div>
  );
}

function formatBytesShort(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function AttachmentsList({
  attachments,
  labels,
}: {
  attachments: TimelineAttachment[];
  labels: InteractionsTimelineLabels["attachments"];
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleDownload(attachmentId: string) {
    setError(null);
    setPendingId(attachmentId);
    startTransition(async () => {
      try {
        const { url } = await getAttachmentDownloadUrlAction({ attachmentId });
        // window.open opens the signed URL in a new tab — Supabase Storage
        // returns the file with the right Content-Disposition so the browser
        // downloads instead of rendering inline.
        window.open(url, "_blank", "noopener");
      } catch {
        setError(labels.downloadError);
      } finally {
        setPendingId(null);
      }
    });
  }

  return (
    <div className="mt-2 space-y-1">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {labels.sectionLabel}
      </p>
      <ul className="space-y-1">
        {attachments.map((att) => (
          <li key={att.id}>
            <button
              type="button"
              onClick={() => handleDownload(att.id)}
              disabled={pendingId === att.id}
              className={cn(
                "inline-flex items-center gap-2 px-2 py-1 rounded-md text-xs",
                "border border-border bg-background hover:bg-secondary cursor-pointer",
                "disabled:opacity-60 disabled:cursor-not-allowed",
              )}
              title={att.filename}
            >
              {pendingId === att.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              ) : (
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <span className="max-w-[240px] truncate">{att.filename}</span>
              <span className="text-muted-foreground">{formatBytesShort(att.sizeBytes)}</span>
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="text-[11px] text-rose-700">{error}</p>}
    </div>
  );
}

function StatusBadge({
  status,
  labels,
}: {
  status: string;
  labels: InteractionsTimelineLabels["statuses"];
}) {
  const label = labels[status as keyof typeof labels] ?? status;
  const tone =
    status === "responded"
      ? "bg-emerald-100 text-emerald-800 border-emerald-200"
      : status === "no_answer"
      ? "bg-amber-100 text-amber-800 border-amber-200"
      : status === "done"
      ? "bg-slate-100 text-slate-700 border-slate-200"
      : "bg-blue-50 text-blue-800 border-blue-200";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border",
        tone,
      )}
    >
      {status === "responded" && <Reply className="h-2.5 w-2.5" />}
      {label}
    </span>
  );
}

/**
 * Groups outbound interactions with their email_received replies. Any
 * interaction without a messageId — or whose messageId no peer shares — is
 * its own group. Groups are sorted by the most recent activity inside them,
 * so a reply on an old outbound bubbles the whole conversation to the top.
 */
function groupAndSort(interactions: TimelineInteraction[]): Array<{
  key: string;
  primary: TimelineInteraction;
  replies: TimelineInteraction[];
  latestMs: number;
}> {
  // Index by messageId.
  const byMessageId = new Map<string, TimelineInteraction[]>();
  const standalone: TimelineInteraction[] = [];

  for (const i of interactions) {
    if (!i.messageId) {
      standalone.push(i);
      continue;
    }
    const arr = byMessageId.get(i.messageId);
    if (arr) arr.push(i);
    else byMessageId.set(i.messageId, [i]);
  }

  const groups: Array<{
    key: string;
    primary: TimelineInteraction;
    replies: TimelineInteraction[];
    latestMs: number;
  }> = [];

  // Conversations.
  for (const [messageId, list] of byMessageId.entries()) {
    // Primary = the non-`email_received` interaction (the outbound).
    const primary = list.find((i) => i.type !== "email_received") ?? list[0]!;
    const replies = list
      .filter((i) => i !== primary)
      .sort((a, b) => occurredMs(a) - occurredMs(b)); // oldest reply first under the primary
    const latestMs = Math.max(...list.map(occurredMs));
    groups.push({ key: `msg-${messageId}`, primary, replies, latestMs });
  }

  // Standalone (calls, notes, visits, manual logs without a message FK).
  for (const i of standalone) {
    groups.push({
      key: `solo-${i.id}`,
      primary: i,
      replies: [],
      latestMs: occurredMs(i),
    });
  }

  // Sort groups by latest activity, newest first.
  groups.sort((a, b) => b.latestMs - a.latestMs);
  return groups;
}

function sortByOccurredDesc(interactions: TimelineInteraction[]): TimelineInteraction[] {
  return [...interactions].sort((a, b) => occurredMs(b) - occurredMs(a));
}

function occurredMs(i: TimelineInteraction): number {
  return new Date(i.occurredAt).getTime();
}

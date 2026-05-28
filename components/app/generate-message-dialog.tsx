"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Sparkles, RefreshCw, Copy, X, Loader2, MessageSquarePlus, Check } from "lucide-react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

import {
  generateMessageAction,
  updateMessageStatusAction,
  updateMessageContentAction,
  logSentInteractionAction,
  type GenerateMessageResult,
} from "@/lib/actions/messages";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import {
  annotateMessage,
  type AnnotationContext,
} from "@/lib/messages/message-annotator";
import { getSignalKeywords } from "@/lib/messages/signal-keywords";
import {
  parseChannelIntent,
  type ChannelIntent,
  type MessageChannel,
  type MessageLocale,
} from "@/lib/messages/types";

const CHANNEL_INTENT_VALUES: ChannelIntent[] = [
  "email-first_contact",
  "email-follow_up",
  "email-meeting_request",
  "email-proposal_send",
  "email-reconnect",
  "linkedin-first_contact",
  "linkedin-follow_up",
  "linkedin-meeting_request",
  "linkedin-reconnect",
];

export type GenerateMessageDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "task" | "contact";
  contactId: string;
  companyId: string;
  taskId?: string;

  contactDisplayName: string;
  companyDisplayName: string;

  /** Resolved by the caller from the contact (firstName, lastName, jobTitle, companyName). */
  annotationContact: {
    firstName: string;
    lastName: string;
    jobTitle: string | null;
  };

  defaultChannelIntent: ChannelIntent;
  defaultLocale: MessageLocale;
  /** Translated hint like "Langue préférée de Sophie Durand". */
  preferredLocaleHint: string;

  /** Signal currently on the company (or null). The dialog renders the toggle iff non-null. */
  detectedSignal: { type: string; daysAgo: number; isFresh: boolean } | null;

  /** Per-locale "is the brief configured" flags ; gates the action client-side. */
  brandBriefStatus: { fr: { configured: boolean; excerpt: string | null }; en: { configured: boolean; excerpt: string | null } };
};

type Step =
  | { kind: "config" }
  | { kind: "generating" }
  | { kind: "result"; result: GenerateMessageResult; subject: string; body: string }
  | { kind: "error"; message: string };

export function GenerateMessageDialog(props: GenerateMessageDialogProps) {
  const t = useTranslations("pages.messages");
  const tIntent = useTranslations("pages.messages.channelIntentOptions");
  const tLang = useTranslations("pages.messages.languageOption");
  const router = useRouter();

  // Params (controlled). Reset on dialog open via key prop from parent.
  const [channelIntent, setChannelIntent] = useState<ChannelIntent>(props.defaultChannelIntent);
  const [locale, setLocale] = useState<MessageLocale>(props.defaultLocale);
  const [includeSignal, setIncludeSignal] = useState<boolean>(
    props.detectedSignal !== null && props.detectedSignal.isFresh,
  );
  const [orientation, setOrientation] = useState<string>("");

  const [step, setStep] = useState<Step>({ kind: "config" });
  const [showOrientation, setShowOrientation] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [interactionLogged, setInteractionLogged] = useState(false);
  const [, startTransition] = useTransition();

  const { channel } = parseChannelIntent(channelIntent);
  const briefLocale = props.brandBriefStatus[locale];
  const briefMissing = !briefLocale.configured;

  function resetDialog() {
    setStep({ kind: "config" });
    setShowOrientation(false);
    setEditMode(false);
    setCopied(false);
    setInteractionLogged(false);
    setOrientation("");
  }

  function handleOpenChange(next: boolean) {
    // Closing while we have an un-copied result → mark as discarded.
    if (!next && step.kind === "result" && !copied) {
      const fd = new FormData();
      fd.append("messageId", step.result.messageId);
      fd.append("status", "discarded");
      void updateMessageStatusAction(fd);
    }
    if (!next) resetDialog();
    props.onOpenChange(next);
  }

  async function runGenerate() {
    if (briefMissing) return;
    setStep({ kind: "generating" });

    const fd = new FormData();
    fd.append("contactId", props.contactId);
    fd.append("companyId", props.companyId);
    if (props.taskId) fd.append("taskId", props.taskId);
    fd.append("channelIntent", channelIntent);
    fd.append("locale", locale);
    fd.append("includeSignal", includeSignal ? "true" : "false");
    if (orientation.trim()) fd.append("orientation", orientation.trim());

    try {
      const result = await generateMessageAction(fd);
      setStep({
        kind: "result",
        result,
        subject: result.subject ?? "",
        body: result.body,
      });
      setShowOrientation(false);
      router.refresh();
    } catch (err) {
      setStep({
        kind: "error",
        message:
          err instanceof Error && err.message
            ? err.message
            : t("errors.generationFailed"),
      });
    }
  }

  function handleCopy() {
    if (step.kind !== "result") return;
    const toCopy =
      channel === "email" && step.subject
        ? `${locale === "fr" ? "Objet" : "Subject"}: ${step.subject}\n\n${step.body}`
        : step.body;
    void navigator.clipboard.writeText(toCopy);

    // Persist edits (if any) + flip status to copied. Dialog stays open
    // so the user can also "Log interaction" before closing manually.
    startTransition(async () => {
      const fdContent = new FormData();
      fdContent.append("messageId", step.result.messageId);
      if (step.subject) fdContent.append("subject", step.subject);
      fdContent.append("body", step.body);
      await updateMessageContentAction(fdContent);

      const fdStatus = new FormData();
      fdStatus.append("messageId", step.result.messageId);
      fdStatus.append("status", "copied");
      await updateMessageStatusAction(fdStatus);

      setCopied(true);
    });
  }

  function handleLogInteraction() {
    if (step.kind !== "result" || interactionLogged) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.append("messageId", step.result.messageId);
      await logSentInteractionAction(fd);
      setInteractionLogged(true);
      router.refresh();
    });
  }

  return (
    <DialogPrimitive.Root open={props.open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/30 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 duration-100" />
        <DialogPrimitive.Popup
          className={cn(
            // Mobile/tablet portrait : full-screen sheet (no border-radius,
            // no margins) so the form has room to breathe.
            "fixed inset-0 z-50 w-screen h-[100dvh] flex flex-col overflow-hidden bg-popover outline-none",
            // Desktop : centered floating dialog.
            "lg:inset-auto lg:top-1/2 lg:left-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2",
            "lg:w-[min(1100px,calc(100vw-2rem))] lg:h-[min(720px,calc(100vh-2rem))]",
            "lg:rounded-xl lg:ring-1 lg:ring-foreground/10",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
            "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          )}
        >
          {/* Header (dark) */}
          <div className="shrink-0 flex items-start justify-between gap-3 bg-slate-900 text-white px-5 py-4">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-md bg-amber-500/15 text-amber-300 flex items-center justify-center shrink-0">
                <Sparkles className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <DialogPrimitive.Title className="font-serif text-base font-bold">
                  {t("modalTitle")}
                </DialogPrimitive.Title>
                <p className="text-xs text-slate-300 truncate">
                  {props.companyDisplayName} {t("modalSubtitleArrow")}{" "}
                  {props.contactDisplayName}
                </p>
              </div>
            </div>
            <DialogPrimitive.Close
              aria-label={t("actions.close")}
              className="text-slate-300 hover:text-white p-1 -m-1 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>

          {/* Body — two columns on desktop, stacked on mobile */}
          <div className="flex-1 min-h-0 flex flex-col divide-y divide-border overflow-y-auto lg:overflow-hidden lg:grid lg:grid-cols-[minmax(260px,320px)_1fr] lg:divide-y-0 lg:divide-x">
            {/* Left — parameters */}
            <ParamsColumn
              channelIntent={channelIntent}
              onChannelIntent={setChannelIntent}
              locale={locale}
              onLocale={setLocale}
              preferredLocaleHint={props.preferredLocaleHint}
              includeSignal={includeSignal}
              onIncludeSignal={setIncludeSignal}
              detectedSignal={props.detectedSignal}
              briefLocale={briefLocale}
              briefMissing={briefMissing}
              t={t}
              tIntent={tIntent}
              tLang={tLang}
            />

            {/* Right — result */}
            <ResultColumn
              step={step}
              copied={copied}
              channel={channel}
              locale={locale}
              briefMissing={briefMissing}
              annotationCtx={{
                contactFirstName: props.annotationContact.firstName,
                contactLastName: props.annotationContact.lastName,
                contactJobTitle: props.annotationContact.jobTitle,
                companyName: props.companyDisplayName,
                signalKeywords:
                  props.detectedSignal && includeSignal
                    ? getSignalKeywords(props.detectedSignal.type, locale)
                    : [],
              }}
              onSubjectChange={(v) =>
                setStep((s) => (s.kind === "result" ? { ...s, subject: v } : s))
              }
              onBodyChange={(v) =>
                setStep((s) => (s.kind === "result" ? { ...s, body: v } : s))
              }
              orientation={orientation}
              onOrientationChange={setOrientation}
              showOrientation={showOrientation}
              onShowOrientation={setShowOrientation}
              editMode={editMode}
              onEditMode={setEditMode}
              interactionLogged={interactionLogged}
              onLogInteraction={handleLogInteraction}
              mode={props.mode}
              onGenerate={runGenerate}
              onRegenerate={runGenerate}
              onCopy={handleCopy}
              t={t}
            />
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ---------------------------------------------------------------------------
// Params column (left)
// ---------------------------------------------------------------------------

type ParamsColumnProps = {
  channelIntent: ChannelIntent;
  onChannelIntent: (v: ChannelIntent) => void;
  locale: MessageLocale;
  onLocale: (v: MessageLocale) => void;
  preferredLocaleHint: string;
  includeSignal: boolean;
  onIncludeSignal: (v: boolean) => void;
  detectedSignal: GenerateMessageDialogProps["detectedSignal"];
  briefLocale: { configured: boolean; excerpt: string | null };
  briefMissing: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tIntent: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tLang: any;
};

function ParamsColumn(p: ParamsColumnProps) {
  return (
    <div className="px-5 py-5 space-y-5 overflow-y-auto">
      <p className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
        {p.t("paramsHeader")}
      </p>

      {/* Channel + Intent combined */}
      <div className="space-y-1.5">
        <Label htmlFor="channelIntent">{p.t("fields.channelIntent")}</Label>
        <select
          id="channelIntent"
          name="channelIntent"
          value={p.channelIntent}
          onChange={(e) => p.onChannelIntent(e.target.value as ChannelIntent)}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          {CHANNEL_INTENT_VALUES.map((value) => (
            <option key={value} value={value}>
              {p.tIntent(value)}
            </option>
          ))}
        </select>
      </div>

      {/* Signal — only if detected */}
      {p.detectedSignal && (
        <div className="space-y-1.5">
          <Label>{p.t("fields.signalDetected")}</Label>
          <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-secondary/40 px-2.5 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full shrink-0",
                  p.detectedSignal.isFresh ? "bg-amber-500" : "bg-slate-400",
                )}
              />
              <span className="text-xs truncate">
                {p.detectedSignal.type} ·{" "}
                {p.t("fields.signalAge", { days: p.detectedSignal.daysAgo })}
              </span>
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-foreground/80 cursor-pointer mt-1">
            <input
              type="checkbox"
              checked={p.includeSignal}
              onChange={(e) => p.onIncludeSignal(e.target.checked)}
              className="rounded border-input"
            />
            {p.t("fields.signalInclude")}
          </label>
        </div>
      )}

      {/* Locale */}
      <div className="space-y-1.5">
        <Label>{p.t("fields.language")}</Label>
        <div className="grid grid-cols-2 gap-1 rounded-md border border-input p-1">
          {(["fr", "en"] as const).map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => p.onLocale(code)}
              className={cn(
                "h-7 rounded text-xs font-medium transition-colors",
                p.locale === code
                  ? "bg-brand-teal/10 text-brand-teal"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {p.tLang(code)}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">{p.preferredLocaleHint}</p>
      </div>

      {/* Brand brief excerpt or missing-state */}
      <div className="space-y-1.5 border-t border-border pt-5">
        <Label>{p.t("fields.brandBriefActive")}</Label>
        {p.briefMissing ? (
          <div className="rounded-md border border-amber-300/60 bg-amber-50 p-3">
            <p className="text-xs font-medium text-amber-900">
              {p.t("fields.brandBriefMissingTitle", { locale: p.locale })}
            </p>
            <p className="text-[11px] text-amber-800 mt-0.5">
              {p.t("fields.brandBriefMissingDescription")}
            </p>
            <Link
              href="/settings/brand"
              className="text-xs text-amber-900 hover:underline mt-1 inline-block font-medium"
            >
              {p.t("fields.brandBriefMissingCta")}
            </Link>
          </div>
        ) : (
          <>
            <div className="rounded-md border border-border bg-secondary/40 p-3 text-[11px] text-foreground/80 leading-relaxed">
              <em>&ldquo;{p.briefLocale.excerpt}&rdquo;</em>
            </div>
            <Link
              href="/settings/brand"
              className="text-[11px] text-brand-teal hover:underline"
            >
              {p.t("fields.brandBriefEdit")}
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Result column (right)
// ---------------------------------------------------------------------------

type ResultColumnProps = {
  step: Step;
  copied: boolean;
  channel: MessageChannel;
  locale: MessageLocale;
  briefMissing: boolean;
  annotationCtx: AnnotationContext;
  onSubjectChange: (v: string) => void;
  onBodyChange: (v: string) => void;
  orientation: string;
  onOrientationChange: (v: string) => void;
  showOrientation: boolean;
  onShowOrientation: (v: boolean) => void;
  editMode: boolean;
  onEditMode: (v: boolean) => void;
  interactionLogged: boolean;
  onLogInteraction: () => void;
  /** When "task", the log button label flips to "Mark task as done" because
   *  the server action also completes the task transparently. */
  mode: "task" | "contact";
  onGenerate: () => void;
  onRegenerate: () => void;
  onCopy: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
};

function ResultColumn(p: ResultColumnProps) {
  return (
    <div className="px-5 py-5 flex flex-col gap-3 overflow-y-auto">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
          {p.t("resultHeader")}
        </p>
        {p.step.kind === "result" && (
          <span className="text-[11px] text-muted-foreground">
            {p.t("metadata.generatedAgo", {
              tokens: p.step.result.tokensIn + p.step.result.tokensOut,
            })}
          </span>
        )}
      </div>

      {/* Empty state */}
      {p.step.kind === "config" && (
        <EmptyState
          briefMissing={p.briefMissing}
          onGenerate={p.onGenerate}
          t={p.t}
        />
      )}

      {/* Generating */}
      {p.step.kind === "generating" && (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground py-12">
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
          {p.t("actions.generating")}
        </div>
      )}

      {/* Error */}
      {p.step.kind === "error" && (
        <div className="flex-1 py-12 text-center text-sm text-rose-700">
          {p.step.message}
          <div className="mt-3">
            <Button type="button" size="sm" variant="outline" onClick={p.onGenerate}>
              {p.t("actions.regenerate")}
            </Button>
          </div>
        </div>
      )}

      {/* Result */}
      {p.step.kind === "result" && (
        <>
          {p.channel === "email" && (
            <div className="space-y-1.5">
              <Label htmlFor="msg-subject">{p.t("fields.subject")}</Label>
              <Input
                id="msg-subject"
                value={p.step.subject}
                onChange={(e) => p.onSubjectChange(e.target.value)}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="msg-body">{p.t("fields.body")}</Label>
              <button
                type="button"
                onClick={() => p.onEditMode(!p.editMode)}
                className="text-[11px] text-brand-teal hover:underline cursor-pointer"
              >
                {p.editMode ? p.t("actions.preview") : p.t("actions.edit")}
              </button>
            </div>

            {p.editMode ? (
              <Textarea
                id="msg-body"
                rows={10}
                value={p.step.body}
                onChange={(e) => p.onBodyChange(e.target.value)}
                className="text-sm leading-relaxed"
              />
            ) : (
              <div
                className="rounded-md border border-border bg-secondary/30 px-3 py-2.5 text-sm leading-relaxed whitespace-pre-wrap min-h-[200px]"
                aria-label={p.t("fields.body")}
              >
                {renderAnnotated(p.step.body, p.annotationCtx)}
              </div>
            )}
          </div>

          {/* Legend — only visible in preview (annotated) mode */}
          {!p.editMode && (
            <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
                {p.t("legend.personalize")}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                {p.t("legend.signalInjected")}
              </span>
            </div>
          )}

          {/* Action bar */}
          {!p.showOrientation ? (
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => p.onShowOrientation(true)}
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                {p.t("actions.regenerate")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={p.onCopy}
                disabled={p.copied}
                className="ml-auto"
              >
                {p.copied ? (
                  <Check className="h-3.5 w-3.5 mr-1.5 text-emerald-600" />
                ) : (
                  <Copy className="h-3.5 w-3.5 mr-1.5" />
                )}
                {p.copied ? p.t("actions.copied") : p.t("actions.copy")}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={p.onLogInteraction}
                disabled={p.interactionLogged}
              >
                {p.interactionLogged ? (
                  <Check className="h-3.5 w-3.5 mr-1.5" />
                ) : (
                  <MessageSquarePlus className="h-3.5 w-3.5 mr-1.5" />
                )}
                {p.interactionLogged
                  ? p.t(p.mode === "task" ? "actions.markTaskDoneDone" : "actions.logInteractionDone")
                  : p.t(p.mode === "task" ? "actions.markTaskDone" : "actions.logInteraction")}
              </Button>
            </div>
          ) : (
            <div className="space-y-2 pt-1 rounded-md border border-border bg-secondary/30 p-3">
              <Label htmlFor="msg-orientation">{p.t("fields.orientation")}</Label>
              <Textarea
                id="msg-orientation"
                rows={2}
                value={p.orientation}
                onChange={(e) => p.onOrientationChange(e.target.value)}
                placeholder={p.t("fields.orientationPlaceholder")}
              />
              <div className="flex items-center gap-2 justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => p.onShowOrientation(false)}
                >
                  {p.t("actions.regenerateCancel")}
                </Button>
                <Button type="button" size="sm" onClick={p.onRegenerate}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  {p.t("actions.regenerateConfirm")}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function EmptyState({
  briefMissing,
  onGenerate,
  t,
}: {
  briefMissing: boolean;
  onGenerate: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center py-12 gap-4">
      <Sparkles className="h-8 w-8 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground max-w-[28ch]">
        {t("emptyState")}
      </p>
      <Button type="button" onClick={onGenerate} disabled={briefMissing}>
        {t("actions.generate")}
      </Button>
    </div>
  );
}

function renderAnnotated(text: string, ctx: AnnotationContext): ReactNode {
  const segments = annotateMessage(text, ctx);
  return segments.map((s, i) => {
    if (s.kind === "personalize") {
      return (
        <span key={i} className="bg-sky-100 text-sky-900 rounded-sm px-0.5">
          {s.text}
        </span>
      );
    }
    if (s.kind === "signal") {
      return (
        <span key={i} className="bg-amber-100 text-amber-900 rounded-sm px-0.5">
          {s.text}
        </span>
      );
    }
    return <span key={i}>{s.text}</span>;
  });
}

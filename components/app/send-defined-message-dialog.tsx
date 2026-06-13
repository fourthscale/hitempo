"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Loader2,
  Copy,
  Check,
  MessageSquarePlus,
  Paperclip,
  X,
  AlertTriangle,
  FileText,
  Variable,
  Send,
} from "lucide-react";
import { GmailIcon } from "@/components/app/gmail-icon";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

import {
  prefillDefinedMessageAction,
  logSentInteractionAction,
  sendMessageViaGmailAction,
  type PrefillDefinedMessageResult,
} from "@/lib/actions/messages";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  TEMPLATE_VARIABLES_BY_CATEGORY,
  type TemplateVariableCategory,
} from "@/lib/messages/template-variables";
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
  isAllowedAttachmentMimeType,
} from "@/lib/gmail/attachment-limits";

export type SendDefinedMessageDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  gmail: { connected: boolean; address: string | null; provider?: "gmail" | "outlook" | null };
};

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      prefill: PrefillDefinedMessageResult;
      subject: string;
      body: string;
      /** Storage paths the sale removed locally for this send only. The
       *  step config in the sequence stays untouched. */
      removedStepAttachmentPaths: Set<string>;
    };

/**
 * Sprint 12 phase 3 — companion to `GenerateMessageDialog` for tasks
 * whose source step is in `defined` mode. Visual language mirrors the
 * AI dialog (dark slate header, Gmail-branded send button, same footer
 * rhythm) so the sale gets one consistent compose surface.
 *
 * Diffs vs the AI dialog (intentional) :
 *   - No "Generate" / "Regenerate" step — content arrives rendered.
 *   - No intent/locale/orientation/signal pickers — fixed at the step.
 *   - No tokens metadata, no brief check.
 *   - Variable insertion picker inserts the *resolved value* at cursor.
 *   - Step pre-attachments can be removed locally (per send), not the
 *     step config itself.
 *
 * Shared at the server-action layer : `sendMessageViaGmailAction` and
 * `logSentInteractionAction` (envoi + persist + log + complete-task +
 * Storage archive + reply polling kick) handle the side effects
 * identically for both flows.
 */
export function SendDefinedMessageDialog(p: SendDefinedMessageDialogProps) {
  const t = useTranslations("pages.messages");
  const tDef = useTranslations("pages.messages.defined");
  const tVarLabel = useTranslations("templateVariables.labels");
  const tVarCategory = useTranslations("templateVariables.category");
  const router = useRouter();

  const [state, setState] = useState<State>({ kind: "loading" });
  const [gmailSent, setGmailSent] = useState(false);
  const [gmailSending, setGmailSending] = useState(false);
  const [gmailError, setGmailError] = useState<string | null>(null);
  const [interactionLogged, setInteractionLogged] = useState(false);
  const [copied, setCopied] = useState(false);
  const [, startTransition] = useTransition();

  // User-added attachments (in addition to non-removed step attachments).
  const [attachments, setAttachments] = useState<File[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  const subjectRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const [variablePickerOpen, setVariablePickerOpen] = useState<
    "subject" | "body" | null
  >(null);

  // Reload prefill every time the dialog opens for a fresh task. Lint
  // rule "set-state-in-effect" disabled on purpose — we genuinely want
  // a clean slate per open transition.
  useEffect(() => {
    if (!p.open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ kind: "loading" });
    setGmailSent(false);
    setGmailSending(false);
    setGmailError(null);
    setInteractionLogged(false);
    setCopied(false);
    setAttachments([]);
    setAttachmentError(null);
    setVariablePickerOpen(null);
    const fd = new FormData();
    fd.append("taskId", p.taskId);
    prefillDefinedMessageAction(fd)
      .then((prefill) => {
        if (cancelled) return;
        setState({
          kind: "ready",
          prefill,
          subject: prefill.subject,
          body: prefill.body,
          removedStepAttachmentPaths: new Set(),
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof Error && err.message ? err.message : tDef("errors.loadFailed");
        setState({ kind: "error", message });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.open, p.taskId]);

  function handleOpenChange(next: boolean) {
    p.onOpenChange(next);
  }

  // ---------------------------------------------------------------------
  // Attachments — same caps + same MIME allow-list as the AI dialog.
  // ---------------------------------------------------------------------
  function addAttachments(files: FileList | File[] | null) {
    if (!files) return;
    setAttachmentError(null);
    const incoming = Array.from(files);
    if (incoming.length === 0) return;

    // Count the step attachments still active (= not user-removed) toward
    // the per-message cap so the Gmail-side limit holds.
    const activeStepCount =
      state.kind === "ready"
        ? state.prefill.stepAttachments.length - state.removedStepAttachmentPaths.size
        : 0;

    if (attachments.length + incoming.length + activeStepCount > MAX_ATTACHMENTS_PER_MESSAGE) {
      setAttachmentError(
        t("attachments.errors.tooMany", { max: MAX_ATTACHMENTS_PER_MESSAGE }),
      );
      return;
    }
    const accepted: File[] = [];
    let total = attachments.reduce((s, f) => s + f.size, 0);
    for (const f of incoming) {
      if (!isAllowedAttachmentMimeType(f.type)) {
        setAttachmentError(
          t("attachments.errors.unsupportedType", {
            filename: f.name,
            allowed: ALLOWED_ATTACHMENT_MIME_TYPES.join(", "),
          }),
        );
        return;
      }
      if (f.size > MAX_ATTACHMENT_BYTES) {
        setAttachmentError(
          t("attachments.errors.tooLarge", {
            filename: f.name,
            max: Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024),
          }),
        );
        return;
      }
      total += f.size;
      if (total > MAX_TOTAL_ATTACHMENT_BYTES) {
        setAttachmentError(
          t("attachments.errors.totalTooLarge", {
            max: Math.round(MAX_TOTAL_ATTACHMENT_BYTES / 1024 / 1024),
          }),
        );
        return;
      }
      accepted.push(f);
    }
    setAttachments((prev) => [...prev, ...accepted]);
  }

  function removeAttachment(idx: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
    setAttachmentError(null);
  }

  function toggleStepAttachmentRemoved(storagePath: string) {
    if (state.kind !== "ready") return;
    const next = new Set(state.removedStepAttachmentPaths);
    if (next.has(storagePath)) next.delete(storagePath);
    else next.add(storagePath);
    setState({ ...state, removedStepAttachmentPaths: next });
  }

  // ---------------------------------------------------------------------
  // Variable picker — inserts the *resolved value* at the cursor. No
  // re-render at send : WYSIWYG strict.
  // ---------------------------------------------------------------------
  function insertVariable(field: "subject" | "body", value: string) {
    if (state.kind !== "ready") return;
    if (field === "subject") {
      const el = subjectRef.current;
      const before = state.subject.slice(0, el?.selectionStart ?? state.subject.length);
      const after = state.subject.slice(el?.selectionEnd ?? state.subject.length);
      setState({ ...state, subject: `${before}${value}${after}` });
    } else {
      const el = bodyRef.current;
      const before = state.body.slice(0, el?.selectionStart ?? state.body.length);
      const after = state.body.slice(el?.selectionEnd ?? state.body.length);
      setState({ ...state, body: `${before}${value}${after}` });
    }
    setVariablePickerOpen(null);
  }

  // ---------------------------------------------------------------------
  // Commit — same FormData shape as the AI dialog, with empty llmUsageId
  // (the action writes NULL to messages.llm_usage_id, nullable since
  // Sprint 12 phase 3).
  // ---------------------------------------------------------------------
  function buildCommitFormData(): FormData | null {
    if (state.kind !== "ready") return null;
    const fullContent =
      state.prefill.channel === "email"
        ? `${state.prefill.locale === "fr" ? "Objet" : "Subject"}: ${state.subject}\n\n${state.body}`
        : state.body;
    const fd = new FormData();
    fd.append("contactId", state.prefill.contactId);
    fd.append("companyId", state.prefill.companyId);
    fd.append("taskId", p.taskId);
    fd.append(
      "channelIntent",
      `${state.prefill.channel}-${state.prefill.intent}`,
    );
    fd.append("locale", state.prefill.locale);
    fd.append("content", fullContent);
    fd.append("llmUsageId", "");
    return fd;
  }

  function handleCopy() {
    if (state.kind !== "ready") return;
    const toCopy =
      state.prefill.channel === "email"
        ? `${state.prefill.locale === "fr" ? "Objet" : "Subject"}: ${state.subject}\n\n${state.body}`
        : state.body;
    void navigator.clipboard.writeText(toCopy);
    setCopied(true);
  }

  function handleLogInteraction() {
    if (state.kind !== "ready" || interactionLogged) return;
    const fd = buildCommitFormData();
    if (!fd) return;
    startTransition(async () => {
      await logSentInteractionAction(fd);
      setInteractionLogged(true);
      router.refresh();
    });
  }

  async function handleSendViaGmail() {
    if (state.kind !== "ready" || gmailSent || gmailSending) return;
    const fd = buildCommitFormData();
    if (!fd) return;
    for (const f of attachments) fd.append("attachments", f, f.name);
    const activeStepAttachments = state.prefill.stepAttachments.filter(
      (a) => !state.removedStepAttachmentPaths.has(a.storagePath),
    );
    if (activeStepAttachments.length > 0) {
      fd.append("stepAttachmentPaths", JSON.stringify(activeStepAttachments));
    }
    setGmailError(null);
    setGmailSending(true);
    try {
      await sendMessageViaGmailAction(fd);
      setGmailSent(true);
      setInteractionLogged(true);
      router.refresh();
    } catch (err) {
      setGmailError(
        err instanceof Error && err.message ? err.message : t("actions.gmailSendFailed"),
      );
    } finally {
      setGmailSending(false);
    }
  }

  // ---------------------------------------------------------------------
  // Render — mirrors GenerateMessageDialog (dark header, Gmail-branded
  // send button, same footer rhythm).
  // ---------------------------------------------------------------------
  return (
    <DialogPrimitive.Root open={p.open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/30 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 duration-100" />
        <DialogPrimitive.Popup
          className={cn(
            // Mobile : full-screen sheet. Desktop : centered floating.
            "fixed inset-0 z-50 w-screen h-[100dvh] flex flex-col overflow-hidden bg-popover outline-none",
            "lg:inset-auto lg:top-1/2 lg:left-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2",
            "lg:w-[min(820px,calc(100vw-2rem))] lg:h-[min(720px,calc(100vh-2rem))]",
            "lg:rounded-xl lg:ring-1 lg:ring-foreground/10",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
            "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          )}
        >
          {/* Header (dark, mirrors GenerateMessageDialog) */}
          <div className="shrink-0 flex items-start justify-between gap-3 bg-slate-900 text-white px-5 py-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="h-9 w-9 rounded-md bg-sky-500/15 text-sky-300 flex items-center justify-center shrink-0">
                <Send className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <DialogPrimitive.Title className="font-serif text-base font-bold">
                  {tDef("title")}
                </DialogPrimitive.Title>
                {state.kind === "ready" && (
                  <p className="text-xs text-slate-300 truncate">
                    {state.prefill.companyDisplayName}{" "}
                    {t("modalSubtitleArrow")}{" "}
                    {state.prefill.contactDisplayName}
                  </p>
                )}
              </div>
            </div>
            <DialogPrimitive.Close
              aria-label={t("actions.close")}
              className="text-slate-300 hover:text-white p-1 -m-1 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>

          {/* Body */}
          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5 space-y-4">
            {state.kind === "loading" && (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {tDef("loading")}
              </div>
            )}

            {state.kind === "error" && (
              <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                {state.message}
              </div>
            )}

            {state.kind === "ready" && (
              <>
                {/* Missing / unknown variable warnings */}
                {(state.prefill.missingVariables.length > 0 ||
                  state.prefill.unknownVariables.length > 0) && (
                  <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <div className="space-y-1">
                      {state.prefill.missingVariables.length > 0 && (
                        <p>
                          {tDef("warnings.missing", {
                            list: state.prefill.missingVariables
                              .map((k) => safeT(tVarLabel, k, k))
                              .join(", "),
                          })}
                        </p>
                      )}
                      {state.prefill.unknownVariables.length > 0 && (
                        <p>
                          {tDef("warnings.unknown", {
                            list: state.prefill.unknownVariables.join(", "),
                          })}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Subject (email only) */}
                {state.prefill.channel === "email" && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                        {t("fields.subject")}
                      </Label>
                      <VariablePickerButton
                        variables={state.prefill.variables}
                        label={tDef("insertVariable")}
                        emptyTooltip={tDef("emptyVariableTooltip")}
                        open={variablePickerOpen === "subject"}
                        onOpenChange={(o) =>
                          setVariablePickerOpen(o ? "subject" : null)
                        }
                        onPick={(value) => insertVariable("subject", value)}
                        tVarLabel={tVarLabel}
                        tVarCategory={tVarCategory}
                      />
                    </div>
                    <Input
                      ref={subjectRef}
                      value={state.subject}
                      onChange={(e) =>
                        setState({ ...state, subject: e.target.value })
                      }
                      disabled={gmailSent || gmailSending}
                    />
                  </div>
                )}

                {/* Body */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                      {t("fields.body")}
                    </Label>
                    <VariablePickerButton
                      variables={state.prefill.variables}
                      label={tDef("insertVariable")}
                      emptyTooltip={tDef("emptyVariableTooltip")}
                      open={variablePickerOpen === "body"}
                      onOpenChange={(o) =>
                        setVariablePickerOpen(o ? "body" : null)
                      }
                      onPick={(value) => insertVariable("body", value)}
                      tVarLabel={tVarLabel}
                      tVarCategory={tVarCategory}
                    />
                  </div>
                  <Textarea
                    ref={bodyRef}
                    value={state.body}
                    onChange={(e) => setState({ ...state, body: e.target.value })}
                    rows={10}
                    disabled={gmailSent || gmailSending}
                    className="font-sans"
                  />
                </div>

                {/* Step attachments — removable (per-send only). Visually
                    distinct chip (muted bg) so the sale knows they come
                    from the sequence. */}
                {state.prefill.channel === "email" &&
                  p.gmail.connected &&
                  state.prefill.stepAttachments.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                        {t("stepAttachments.label")}
                      </Label>
                      <ul className="space-y-1">
                        {state.prefill.stepAttachments.map((a) => {
                          const removed = state.removedStepAttachmentPaths.has(
                            a.storagePath,
                          );
                          return (
                            <li
                              key={a.storagePath}
                              className={cn(
                                "flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs",
                                removed && "opacity-50 line-through",
                              )}
                            >
                              <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <span
                                className="min-w-0 flex-1 truncate"
                                title={a.filename}
                              >
                                {a.filename}
                              </span>
                              <span className="shrink-0 text-muted-foreground">
                                {formatBytes(a.sizeBytes)}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  toggleStepAttachmentRemoved(a.storagePath)
                                }
                                disabled={gmailSent || gmailSending}
                                aria-label={
                                  removed
                                    ? tDef("stepAttachments.restore")
                                    : tDef("stepAttachments.remove")
                                }
                                className="shrink-0 text-muted-foreground hover:text-rose-600 disabled:opacity-50"
                              >
                                {removed ? (
                                  <RestoreIcon className="h-3.5 w-3.5" />
                                ) : (
                                  <X className="h-3.5 w-3.5" />
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                      <p className="text-[11px] text-muted-foreground">
                        {tDef("stepAttachments.removeHelp")}
                      </p>
                    </div>
                  )}

                {/* User attachments — same UX as the AI dialog. */}
                {state.prefill.channel === "email" && p.gmail.connected && (
                  <AttachmentsPicker
                    attachments={attachments}
                    onAdd={addAttachments}
                    onRemove={removeAttachment}
                    error={attachmentError}
                    disabled={gmailSent || gmailSending}
                    t={t}
                  />
                )}
              </>
            )}
          </div>

          {/* Footer — mirrors GenerateMessageDialog's button rhythm */}
          {state.kind === "ready" && (
            <div className="shrink-0 border-t border-border px-5 py-3 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopy}
                disabled={copied}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 mr-1.5 text-emerald-600" />
                ) : (
                  <Copy className="h-3.5 w-3.5 mr-1.5" />
                )}
                {copied ? t("actions.copied") : t("actions.copy")}
              </Button>

              <Button
                type="button"
                size="sm"
                variant={
                  state.prefill.channel === "email" && p.gmail.connected
                    ? "outline"
                    : "default"
                }
                onClick={handleLogInteraction}
                disabled={interactionLogged || gmailSending}
                className="ml-auto sm:ml-0"
              >
                {interactionLogged ? (
                  <Check className="h-3.5 w-3.5 mr-1.5" />
                ) : (
                  <MessageSquarePlus className="h-3.5 w-3.5 mr-1.5" />
                )}
                {interactionLogged
                  ? t("actions.markTaskDoneDone")
                  : t("actions.markTaskDone")}
              </Button>

              {/* Gmail-branded send button — identical styling to the AI
                  dialog (white bg, [#dadce0] border, official mark). */}
              {state.prefill.channel === "email" && p.gmail.connected && (
                <button
                  type="button"
                  onClick={handleSendViaGmail}
                  disabled={gmailSent || gmailSending}
                  title={p.gmail.address ?? undefined}
                  className={cn(
                    "ml-auto inline-flex items-center gap-2 h-9 pl-3 pr-3.5 rounded-md",
                    "bg-white border border-[#dadce0] text-[#3c4043] text-sm font-medium",
                    "hover:shadow-md hover:bg-[#f8faff] transition-all cursor-pointer",
                    "disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:shadow-none disabled:hover:bg-white",
                  )}
                >
                  {gmailSending ? (
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  ) : gmailSent ? (
                    <Check className="h-4 w-4 shrink-0 text-emerald-600" />
                  ) : (
                    <GmailIcon className="h-4 w-4 shrink-0" />
                  )}
                  <span>
                    {gmailSending
                      ? t("actions.gmailSending")
                      : gmailSent
                      ? t("actions.gmailSent")
                      : p.gmail.provider === "outlook"
                      ? t("actions.sendViaOutlook")
                      : t("actions.sendViaGmail")}
                  </span>
                </button>
              )}

              {state.prefill.channel === "email" && !p.gmail.connected && (
                <p className="w-full text-[11px] text-muted-foreground">
                  <Link
                    href="/settings/profile"
                    className="text-brand-teal hover:underline"
                  >
                    {t("actions.connectGmailHint")}
                  </Link>
                </p>
              )}

              {gmailError && (
                <p className="w-full text-[11px] text-rose-700">{gmailError}</p>
              )}
            </div>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ---------------------------------------------------------------------------
// VariablePickerButton — popover with categorized list
// ---------------------------------------------------------------------------

function VariablePickerButton(props: {
  variables: PrefillDefinedMessageResult["variables"];
  label: string;
  emptyTooltip: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (value: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tVarLabel: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tVarCategory: any;
}) {
  const valueByKey = new Map(props.variables.map((v) => [v.key, v.value]));
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => props.onOpenChange(!props.open)}
        className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary/40 px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <Variable className="h-3 w-3" />
        {props.label}
      </button>
      {props.open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => props.onOpenChange(false)}
          />
          <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-md border border-border bg-popover p-2 text-xs shadow-md">
            {(
              Object.keys(TEMPLATE_VARIABLES_BY_CATEGORY) as TemplateVariableCategory[]
            ).map((cat) => (
              <div key={cat} className="mb-1.5 last:mb-0">
                <div className="px-1 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {props.tVarCategory(cat)}
                </div>
                <ul>
                  {TEMPLATE_VARIABLES_BY_CATEGORY[cat].map((v) => {
                    const value = valueByKey.get(v.key) ?? "";
                    const empty = value.trim().length === 0;
                    return (
                      <li key={v.key}>
                        <button
                          type="button"
                          disabled={empty}
                          onClick={() => !empty && props.onPick(value)}
                          className={cn(
                            "flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left",
                            empty
                              ? "cursor-not-allowed text-muted-foreground opacity-60"
                              : "hover:bg-secondary",
                          )}
                          title={empty ? props.emptyTooltip : value}
                        >
                          <span>{props.tVarLabel(v.labelKey)}</span>
                          <span className="truncate text-[10px] text-muted-foreground">
                            {empty ? "—" : value}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AttachmentsPicker — inline (same UX as the AI dialog)
// ---------------------------------------------------------------------------

function AttachmentsPicker(p: {
  attachments: File[];
  onAdd: (files: FileList | File[] | null) => void;
  onRemove: (idx: number) => void;
  error: string | null;
  disabled: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}) {
  const reachedMax = p.attachments.length >= MAX_ATTACHMENTS_PER_MESSAGE;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          {p.t("attachments.label")}
        </Label>
        <span className="text-[11px] text-muted-foreground">
          {p.t("attachments.hint", {
            max: MAX_ATTACHMENTS_PER_MESSAGE,
            sizeMb: Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024),
          })}
        </span>
      </div>
      <label
        className={cn(
          "inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium",
          "border border-dashed border-border bg-secondary/40 hover:bg-secondary cursor-pointer",
          (p.disabled || reachedMax) &&
            "opacity-60 cursor-not-allowed hover:bg-secondary/40",
        )}
      >
        <Paperclip className="h-3.5 w-3.5" />
        {p.t("attachments.add")}
        <input
          type="file"
          accept={ALLOWED_ATTACHMENT_MIME_TYPES.join(",")}
          multiple
          className="hidden"
          disabled={p.disabled || reachedMax}
          onChange={(e) => {
            p.onAdd(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      {p.attachments.length > 0 && (
        <ul className="space-y-1">
          {p.attachments.map((file, idx) => (
            <li
              key={`${file.name}-${idx}`}
              className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate" title={file.name}>
                {file.name}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {formatBytes(file.size)}
              </span>
              <button
                type="button"
                onClick={() => p.onRemove(idx)}
                disabled={p.disabled}
                aria-label={p.t("attachments.remove")}
                className="text-muted-foreground hover:text-rose-600 disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {p.error && <p className="text-[11px] text-rose-700">{p.error}</p>}
    </div>
  );
}

// Tiny inline restore icon (counter-clockwise arrow) — kept inline to
// avoid pulling another lucide import just for one button.
function RestoreIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <polyline points="3 4 3 9 8 9" />
    </svg>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safeT(t: any, key: string, fallback: string): string {
  try {
    return t(key);
  } catch {
    return fallback;
  }
}

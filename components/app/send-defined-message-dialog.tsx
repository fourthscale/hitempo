"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
  /** Task this send completes — the source step's template is rendered. */
  taskId: string;
  /** Sender Gmail OAuth state — drives the "Send via Gmail" button. */
  gmail: { connected: boolean; address: string | null };
};

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      prefill: PrefillDefinedMessageResult;
      subject: string;
      body: string;
    };

/**
 * Sprint 12 phase 3 — companion to `GenerateMessageDialog` for tasks
 * whose source step is in `defined` mode.
 *
 * Differences with the AI dialog :
 *   - No generation step : opens, fetches the rendered template, shows it.
 *   - No intent/locale/orientation pickers (already fixed by the step).
 *   - No tokens / brief-missing UX.
 *   - "Insert variable" picker inserts the *resolved value* at the cursor.
 *
 * Shared with the AI dialog at the **server-action layer** :
 *   - `sendMessageViaGmailAction` (envoi + persist + log + complete + cleanup)
 *   - `logSentInteractionAction` (log + complete task without Gmail send)
 * Both auto-close the task, log an outbound interaction, archive
 * attachments to Storage, kick the engine forward — same as AI.
 */
export function SendDefinedMessageDialog(p: SendDefinedMessageDialogProps) {
  const t = useTranslations("pages.messages");
  const tDef = useTranslations("pages.messages.defined");
  const tVarLabel = useTranslations("templateVariables.labels");
  const tVarCategory = useTranslations("templateVariables.category");
  const router = useRouter();

  const [state, setState] = useState<State>({ kind: "loading" });
  // Send/log/copy state — mirrors the AI dialog naming so it reads the same.
  const [gmailSent, setGmailSent] = useState(false);
  const [gmailSending, setGmailSending] = useState(false);
  const [gmailError, setGmailError] = useState<string | null>(null);
  const [interactionLogged, setInteractionLogged] = useState(false);
  const [copied, setCopied] = useState(false);
  const [, startTransition] = useTransition();

  // User-uploaded attachments (in addition to the step's pre-attached files).
  const [attachments, setAttachments] = useState<File[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  // Refs to compute cursor position for variable insertion.
  const subjectRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const [variablePickerOpen, setVariablePickerOpen] = useState<
    "subject" | "body" | null
  >(null);

  function resetDialog() {
    setState({ kind: "loading" });
    setGmailSent(false);
    setGmailSending(false);
    setGmailError(null);
    setInteractionLogged(false);
    setCopied(false);
    setAttachments([]);
    setAttachmentError(null);
    setVariablePickerOpen(null);
  }

  // Load the prefill payload the moment the dialog opens. The action
  // looks up step config, contact, company, sender, then resolves +
  // renders the template — all server-side.
  //
  // We intentionally reset all the local commit-state flags here too
  // (gmailSent / interactionLogged / etc.) so re-opening the dialog
  // for the same task doesn't show stale "sent" badges. The lint rule
  // forbids calling setState directly in an effect — disabled here
  // because we genuinely want a fresh state per open transition.
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
    if (!next) resetDialog();
    p.onOpenChange(next);
  }

  // -------------------------------------------------------------------------
  // Attachments — same caps + same MIME allow-list as the AI dialog.
  // -------------------------------------------------------------------------
  function addAttachments(files: FileList | File[] | null) {
    if (!files) return;
    setAttachmentError(null);
    const incoming = Array.from(files);
    if (incoming.length === 0) return;
    if (attachments.length + incoming.length > MAX_ATTACHMENTS_PER_MESSAGE) {
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

  // -------------------------------------------------------------------------
  // Variable picker — inserts the *resolved value* at the cursor. No
  // re-render at send : what the sale sees is what gets sent.
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // Commit — builds the same FormData shape the AI dialog posts. The
  // server actions don't care whether the content came from an LLM or a
  // rendered template ; they just persist + send.
  //
  // One nuance vs the AI dialog : the AI flow posts an `llmUsageId`
  // because every LLM call logs in `llm_usage`. Defined-mode has no
  // LLM call, so we send an empty `llmUsageId` and the action writes
  // NULL to the `messages.llm_usage_id` column (nullable since
  // Sprint 12 phase 3). No fake audit row pollutes the table.
  // -------------------------------------------------------------------------
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
      `${state.prefill.channel}-${state.prefill.intent}` as const,
    );
    fd.append("locale", state.prefill.locale);
    fd.append("content", fullContent);
    // Empty string → action writes NULL llm_usage_id (defined mode = no LLM).
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
    if (state.prefill.stepAttachments.length > 0) {
      fd.append(
        "stepAttachmentPaths",
        JSON.stringify(state.prefill.stepAttachments),
      );
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

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <DialogPrimitive.Root open={p.open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" />
        <DialogPrimitive.Popup
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-2xl border border-border bg-card shadow-xl",
            "sm:inset-x-auto sm:top-1/2 sm:left-1/2 sm:max-h-[90vh] sm:w-[min(720px,calc(100vw-2rem))]",
            "sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl",
            "max-h-[92vh] outline-none",
          )}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-base font-semibold">
                {tDef("title")}
              </DialogPrimitive.Title>
              {state.kind === "ready" && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {tDef("subtitle", {
                    contact: state.prefill.contactDisplayName,
                    company: state.prefill.companyDisplayName,
                  })}
                </p>
              )}
            </div>
            <DialogPrimitive.Close className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground">
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
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
              <div className="space-y-4">
                {/* Missing-variable / unknown-variable warnings */}
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

                {/* Subject */}
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
                        onOpenChange={(o) => setVariablePickerOpen(o ? "subject" : null)}
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
                      onOpenChange={(o) => setVariablePickerOpen(o ? "body" : null)}
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

                {/* Step attachments — locked, read-only chips */}
                {state.prefill.channel === "email" &&
                  p.gmail.connected &&
                  state.prefill.stepAttachments.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                        {t("stepAttachments.label")}
                      </Label>
                      <ul className="space-y-1">
                        {state.prefill.stepAttachments.map((a) => (
                          <li
                            key={a.storagePath}
                            className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs"
                          >
                            <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1 truncate" title={a.filename}>
                              {a.filename}
                            </span>
                            <span className="shrink-0 text-muted-foreground">
                              {formatBytes(a.sizeBytes)}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <p className="text-[11px] text-muted-foreground">
                        {t("stepAttachments.help")}
                      </p>
                    </div>
                  )}

                {/* User-added attachments picker */}
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
              </div>
            )}
          </div>

          {/* Footer — actions */}
          {state.kind === "ready" && (
            <div className="flex flex-col gap-2 border-t border-border bg-card px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCopy}
                  disabled={gmailSending}
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  {copied ? t("actions.copied") : t("actions.copy")}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleLogInteraction}
                  disabled={interactionLogged || gmailSending}
                >
                  {interactionLogged ? (
                    <Check className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <MessageSquarePlus className="h-4 w-4" />
                  )}
                  {interactionLogged
                    ? t("actions.markTaskDoneDone")
                    : t("actions.markTaskDone")}
                </Button>
              </div>

              <div className="flex items-center gap-2">
                {gmailError && (
                  <span className="text-[11px] text-rose-700">{gmailError}</span>
                )}
                {p.gmail.connected ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSendViaGmail}
                    disabled={gmailSent || gmailSending}
                  >
                    {gmailSending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : gmailSent ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <GmailIcon className="h-4 w-4" />
                    )}
                    {gmailSent ? t("actions.gmailSent") : t("actions.sendViaGmail")}
                  </Button>
                ) : (
                  <span className="text-[11px] text-muted-foreground">
                    {t("actions.connectGmailHint")}
                  </span>
                )}
              </div>
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
  // Build a quick lookup: key → resolved value
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
            {(Object.keys(TEMPLATE_VARIABLES_BY_CATEGORY) as TemplateVariableCategory[]).map(
              (cat) => (
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
              ),
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AttachmentsPicker — inline mini-version (same UX as the AI dialog but
// owned here so we don't import from generate-message-dialog.tsx).
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
          (p.disabled || reachedMax) && "opacity-60 cursor-not-allowed hover:bg-secondary/40",
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Translation lookup that returns a default when the key is missing (next-intl
 * throws otherwise). Used for variable labels that may not all be present in
 * one specific i18n file revision.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safeT(t: any, key: string, fallback: string): string {
  try {
    return t(key);
  } catch {
    return fallback;
  }
}

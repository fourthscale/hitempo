"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { LocalizedStringInput } from "./localized-string-input";
import { ConditionBuilder } from "./condition-builder";
import { StepAttachmentsField } from "./step-attachments-field";
import { emptyGroup, type ConditionGroup } from "@/lib/sequences/conditions";
import type { DraftStep } from "@/lib/sequences/draft-schema";
import type {
  SendMessageActionConfig,
  PhoneCallActionConfig,
  WaitDelayActionConfig,
  UpdateContactActionConfig,
  ConditionalSplitActionConfig,
  ConditionalSwitchActionConfig,
  EnrollInSequenceActionConfig,
  TaskAssignment,
  LocalizedString,
  SequenceStepAttachmentRef,
} from "@/lib/sequences/types";
import type { TaskScheduling } from "@/lib/sequences/scheduling";
import { DEFAULT_SCHEDULING } from "@/lib/sequences/scheduling";

const INTENTS = ["first_contact", "follow_up", "meeting_request", "proposal_send", "reconnect"] as const;
const UNITS = ["minutes", "hours", "days"] as const;
const GATE_CONDITIONS = [
  "always",
  "if_no_inbound",
  "if_responded",
  "if_positive_reply",
  "if_negative_reply",
  "if_no_answer",
] as const;
const CONTACT_STATUSES = ["to_contact", "to_follow_up", "qualified", "not_interested"] as const;
const CONTACT_ROLES = ["decision_maker", "influencer", "user", "prescriber", "assistant", "other"] as const;

const selectCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export function SequenceStepDetailPanel({
  step,
  sequenceId,
  otherSequences,
  orgMembers,
  onChange,
  onDelete,
  onClose,
  canDelete,
}: {
  step: DraftStep;
  /** Sprint 12 — needed by the attachments field to scope storage upload. */
  sequenceId: string;
  otherSequences: { id: string; name: string }[];
  orgMembers: { id: string; name: string }[];
  onChange: (next: DraftStep) => void;
  onDelete: () => void;
  onClose: () => void;
  canDelete: boolean;
}) {
  const t = useTranslations("pages.sequences");
  // The update_contact step's <select>s read from the top-level enums (same as
  // the contact form), not from `pages.sequences.*` — those keys don't live
  // there. Resolve the right namespace once at the top.
  const tContactStatus = useTranslations("contactStatus");
  const tContactRole = useTranslations("contactRole");
  const [confirmBranch, setConfirmBranch] = useState<number | null>(null);

  const patchConfig = (patch: Record<string, unknown>) =>
    onChange({ ...step, actionConfig: { ...step.actionConfig, ...patch } });

  const isMessage = step.actionType === "send_email" || step.actionType === "send_linkedin";
  const isAction =
    isMessage || step.actionType === "phone_call" || step.actionType === "update_contact" || step.actionType === "wait_delay" || step.actionType === "enroll_in_sequence";

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-4">
      {/* Step type is chosen at insertion (via the "+" palette) and is fixed —
          to change it, delete the step and add the right one. */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("editor.fields.actionType")}
          </p>
          <p className="text-sm font-semibold text-foreground">{t(`stepType.${step.actionType}`)}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="-mr-1 -mt-1 rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          aria-label={t("editor.close")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Title — shown on the node. Available on every step except merge. */}
      {step.actionType !== "merge" && (
        <LocalizedStringInput
          label={t("editor.fields.title")}
          value={(step.actionConfig as { titleTemplate?: LocalizedString }).titleTemplate}
          onChange={(v) => patchConfig({ titleTemplate: v })}
        />
      )}

      {/* ----- Assignment (task-creating steps only) -----
          Placed right under the title : it answers "who will own this
          task" before the user dives into channel/intent/body config —
          mirrors the natural reading order of a task card. */}
      {(isMessage || step.actionType === "phone_call") && (
        <AssignmentField
          assignment={(step.actionConfig as { assignment?: TaskAssignment }).assignment}
          orgMembers={orgMembers}
          // Sprint 12 phase 4 — agent auto-execution is only wired for
          // `send_email`. LinkedIn (no public API) and phone_call (real
          // human) always stay manual.
          actorAgentEnabled={step.actionType === "send_email"}
          onChange={(a) => patchConfig({ assignment: a })}
        />
      )}

      {/* ----- Message (email / linkedin) ----- */}
      {isMessage && (() => {
        const cfg = step.actionConfig as Partial<SendMessageActionConfig>;
        return (
          <>
            <div className="space-y-1.5">
              <Label>{t("editor.fields.mode")}</Label>
              <div className="flex gap-2">
                {(["ai", "defined"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => patchConfig({ mode: m })}
                    className={`flex-1 rounded-md border px-3 py-1.5 text-sm ${
                      (cfg.mode ?? "ai") === m ? "border-brand-teal bg-brand-teal/10" : "border-border"
                    }`}
                  >
                    {t(`editor.modes.${m}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t("editor.fields.intent")}</Label>
              <select
                className={selectCls}
                value={cfg.intent ?? "first_contact"}
                onChange={(e) => patchConfig({ intent: e.target.value })}
              >
                {INTENTS.map((v) => (
                  <option key={v} value={v}>
                    {t(`editor.intents.${v}`)}
                  </option>
                ))}
              </select>
            </div>
            {(cfg.mode ?? "ai") === "ai" ? (
              <>
                <LocalizedStringInput
                  label={t("editor.fields.orientation")}
                  value={cfg.orientation}
                  onChange={(v) => patchConfig({ orientation: v })}
                  multiline
                />
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(cfg.includeSignal)}
                    onChange={(e) => patchConfig({ includeSignal: e.target.checked })}
                  />
                  {t("editor.fields.includeSignal")}
                </label>
              </>
            ) : (
              <>
                <LocalizedStringInput
                  label={t("editor.fields.subject")}
                  value={cfg.subject}
                  onChange={(v) => patchConfig({ subject: v })}
                  templating
                />
                <LocalizedStringInput
                  label={t("editor.fields.body")}
                  value={cfg.body}
                  onChange={(v) => patchConfig({ body: v })}
                  multiline
                  templating
                />
              </>
            )}
            {/* Sprint 12 — attachments apply to BOTH modes (AI draft +
                defined message). Gated on actionType because LinkedIn
                doesn't accept file attachments. */}
            {step.actionType === "send_email" && (
              <StepAttachmentsField
                sequenceId={sequenceId}
                stepId={step.id}
                value={(cfg.attachments ?? []) as SequenceStepAttachmentRef[]}
                onChange={(next) => patchConfig({ attachments: next })}
              />
            )}
          </>
        );
      })()}

      {/* ----- Phone call ----- */}
      {step.actionType === "phone_call" && (() => {
        const cfg = step.actionConfig as Partial<PhoneCallActionConfig>;
        return (
          <>
            <LocalizedStringInput
              label={t("editor.fields.description")}
              value={cfg.description}
              onChange={(v) => patchConfig({ description: v })}
              multiline
            />
          </>
        );
      })()}

      {/* ----- Update contact ----- */}
      {step.actionType === "update_contact" && (() => {
        const cfg = step.actionConfig as Partial<UpdateContactActionConfig>;
        return (
          <>
            <div className="space-y-1.5">
              <Label>{t("editor.fields.setStatus")}</Label>
              <select
                className={selectCls}
                value={cfg.setStatus ?? ""}
                onChange={(e) => patchConfig({ setStatus: e.target.value })}
              >
                <option value="">—</option>
                {CONTACT_STATUSES.map((v) => (
                  <option key={v} value={v}>
                    {tContactStatus(v as Parameters<typeof tContactStatus>[0])}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("editor.fields.setRole")}</Label>
              <select
                className={selectCls}
                value={cfg.setRole ?? ""}
                onChange={(e) => patchConfig({ setRole: e.target.value })}
              >
                <option value="">—</option>
                {CONTACT_ROLES.map((v) => (
                  <option key={v} value={v}>
                    {tContactRole(v as Parameters<typeof tContactRole>[0])}
                  </option>
                ))}
              </select>
            </div>
          </>
        );
      })()}

      {/* ----- Wait ----- */}
      {step.actionType === "wait_delay" && (() => {
        const cfg = step.actionConfig as Partial<WaitDelayActionConfig>;
        return (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("editor.fields.duration")}</Label>
              <Input
                type="number"
                min={1}
                value={cfg.durationValue ?? 1}
                onChange={(e) => patchConfig({ durationValue: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("editor.fields.durationUnit")}</Label>
              <select
                className={selectCls}
                value={cfg.durationUnit ?? "days"}
                onChange={(e) => patchConfig({ durationUnit: e.target.value })}
              >
                {UNITS.map((v) => (
                  <option key={v} value={v}>
                    {t(`editor.units.${v}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        );
      })()}

      {/* ----- Enroll in another sequence ----- */}
      {step.actionType === "enroll_in_sequence" && (() => {
        const cfg = step.actionConfig as Partial<EnrollInSequenceActionConfig>;
        return (
          <div className="space-y-1.5">
            <Label>{t("editor.fields.targetSequence")}</Label>
            <select
              className={selectCls}
              value={cfg.targetSequenceId ?? ""}
              onChange={(e) => patchConfig({ targetSequenceId: e.target.value })}
            >
              <option value="">—</option>
              {otherSequences.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        );
      })()}

      {/* ----- Conditional split (if/else) ----- */}
      {step.actionType === "conditional_split" && (() => {
        const cfg = step.actionConfig as Partial<ConditionalSplitActionConfig>;
        return (
          <div className="space-y-2">
            <Label>{t("editor.split.yesHint")}</Label>
            <ConditionBuilder
              value={cfg.condition ?? emptyGroup()}
              onChange={(g) => patchConfig({ condition: g })}
            />
            <p className="text-xs text-muted-foreground">{t("editor.split.elseHint")}</p>
          </div>
        );
      })()}

      {/* ----- Conditional switch (if/elif/else ladder) ----- */}
      {step.actionType === "conditional_switch" && (() => {
        const cfg = step.actionConfig as Partial<ConditionalSwitchActionConfig>;
        const branches = cfg.branches ?? [];
        const cases = (step.nextStepIds?.cases ?? {}) as Record<string, string>;

        const setBranches = (next: { condition: ConditionGroup }[]) =>
          patchConfig({ branches: next });

        const removeBranch = (i: number) => {
          const newCases: Record<string, string> = {};
          for (const [k, v] of Object.entries(cases)) {
            const ki = Number(k);
            if (ki < i) newCases[k] = v;
            else if (ki > i) newCases[String(ki - 1)] = v;
          }
          onChange({
            ...step,
            actionConfig: { branches: branches.filter((_, idx) => idx !== i) },
            nextStepIds: { ...(step.nextStepIds ?? {}), cases: newCases },
          });
          setConfirmBranch(null);
        };

        // A branch "has steps" when its case points somewhere — deleting it
        // drops that path, so ask for confirmation first.
        const requestRemoveBranch = (i: number) => {
          if (cases[String(i)]) setConfirmBranch(i);
          else removeBranch(i);
        };

        return (
          <div className="space-y-3">
            {branches.map((b, i) => (
              <div key={i} className="rounded-md border border-border p-2">
                <div className="mb-1.5 flex items-center justify-between">
                  <Label>{t("editor.switch.branch", { n: i + 1 })}</Label>
                  <button
                    type="button"
                    onClick={() => requestRemoveBranch(i)}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="remove branch"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {confirmBranch === i && (
                  <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 p-2">
                    <p className="text-xs text-amber-800">{t("editor.switch.confirmRemove")}</p>
                    <div className="mt-2 flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => setConfirmBranch(null)}>
                        {t("editor.deletePath.cancel")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive"
                        onClick={() => removeBranch(i)}
                      >
                        {t("editor.deletePath.confirm")}
                      </Button>
                    </div>
                  </div>
                )}
                <ConditionBuilder
                  value={b.condition ?? emptyGroup()}
                  onChange={(g) =>
                    setBranches(branches.map((x, idx) => (idx === i ? { condition: g } : x)))
                  }
                />
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setBranches([...branches, { condition: emptyGroup() }])}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              {t("editor.switch.addBranch")}
            </Button>
            <p className="text-xs text-muted-foreground">{t("editor.switch.elseHint")}</p>
          </div>
        );
      })()}

      {/* ----- Scheduling (task-creating steps only) ----- */}
      {(isMessage || step.actionType === "phone_call") && (
        <>
          <SchedulingField
            scheduling={(step.actionConfig as { scheduling?: TaskScheduling }).scheduling}
            onChange={(s) => patchConfig({ scheduling: s })}
          />
          <AwaitTimeoutField
            value={(step.actionConfig as { awaitTaskTimeoutDays?: number }).awaitTaskTimeoutDays}
            onChange={(v) => patchConfig({ awaitTaskTimeoutDays: v })}
          />
        </>
      )}

      {/* ----- Gating condition (action steps only) ----- */}
      {isAction && step.actionType !== "wait_delay" && (
        <div className="space-y-1.5 border-t border-border pt-4">
          <Label>{t("editor.fields.condition")}</Label>
          <select
            className={selectCls}
            value={step.condition?.type ?? "always"}
            onChange={(e) =>
              onChange({
                ...step,
                condition: e.target.value === "always" ? null : { type: e.target.value },
              })
            }
          >
            {GATE_CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {t(`editor.conditions.${c}`)}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="mt-auto pt-2">
        <Button
          type="button"
          variant="outline"
          className="w-full text-destructive"
          onClick={onDelete}
          disabled={!canDelete}
        >
          <Trash2 className="mr-1.5 h-4 w-4" />
          {t("editor.fields.delete")}
        </Button>
      </div>
    </div>
  );
}

function AssignmentField({
  assignment,
  orgMembers,
  actorAgentEnabled,
  onChange,
}: {
  assignment: TaskAssignment | undefined;
  orgMembers: { id: string; name: string }[];
  /** Sprint 12 phase 4 — true on `send_email` steps only. Other action
   *  types (LinkedIn, phone) can't be auto-executed and the toggle is
   *  greyed out with an explanatory tooltip. */
  actorAgentEnabled: boolean;
  onChange: (a: TaskAssignment) => void;
}) {
  const t = useTranslations("pages.sequences");
  const a: TaskAssignment = assignment ?? { actor: "sales", assignTo: "owner" };

  // Defensive : if the actor is "agent" but the action type no longer
  // supports it (the user flipped the channel from email to phone, for
  // example), bounce back to sales so the engine doesn't see an
  // inconsistent config at publish time. Runs in an effect to avoid
  // setState-during-render.
  useEffect(() => {
    if (!actorAgentEnabled && a.actor === "agent") {
      onChange({ ...a, actor: "sales" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorAgentEnabled, a.actor]);

  return (
    <div className="space-y-2 border-t border-border pt-4">
      <Label>{t("editor.assign.label")}</Label>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onChange({ ...a, actor: "sales" })}
          className={`flex-1 rounded-md border px-3 py-1.5 text-sm ${
            a.actor === "sales" ? "border-brand-teal bg-brand-teal/10" : "border-border"
          }`}
        >
          {t("editor.assign.sales")}
        </button>
        <button
          type="button"
          disabled={!actorAgentEnabled}
          title={actorAgentEnabled ? undefined : t("editor.assign.agentEmailOnly")}
          onClick={() => onChange({ ...a, actor: "agent" })}
          className={`flex-1 rounded-md border px-3 py-1.5 text-sm transition-colors ${
            !actorAgentEnabled
              ? "cursor-not-allowed border-border text-muted-foreground opacity-50"
              : a.actor === "agent"
                ? "border-brand-teal bg-brand-teal/10"
                : "border-border"
          }`}
        >
          {t("editor.assign.agent")}
        </button>
      </div>

      {/* Sprint 12 phase 4 — explain what "agent" actually does so the
          sale knows their Gmail account will be used to send. */}
      {a.actor === "agent" && (
        <p className="text-[11px] text-muted-foreground">
          {t("editor.assign.agentHint")}
        </p>
      )}

      <select
        className={selectCls}
        value={a.assignTo}
        onChange={(e) => onChange({ ...a, assignTo: e.target.value as TaskAssignment["assignTo"] })}
      >
        <option value="owner">{t("editor.assign.owner")}</option>
        <option value="specific">{t("editor.assign.specific")}</option>
      </select>

      {a.assignTo === "specific" && (
        <select
          className={selectCls}
          value={a.userId ?? ""}
          onChange={(e) => onChange({ ...a, userId: e.target.value || undefined })}
        >
          <option value="">—</option>
          {orgMembers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scheduling field — collapsible "Planification" block for task-creating
// steps. All times are entered in the CONTACT's TZ ; the engine converts to
// the assignee's TZ + finds a free slot at task creation.
// ---------------------------------------------------------------------------

const WEEKDAY_OPTIONS: { value: number; key: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun" }[] = [
  { value: 1, key: "mon" },
  { value: 2, key: "tue" },
  { value: 3, key: "wed" },
  { value: 4, key: "thu" },
  { value: 5, key: "fri" },
  { value: 6, key: "sat" },
  { value: 0, key: "sun" },
];

function SchedulingField({
  scheduling,
  onChange,
}: {
  scheduling: TaskScheduling | undefined;
  onChange: (next: TaskScheduling) => void;
}) {
  const t = useTranslations("pages.sequences");
  const s: Required<TaskScheduling> = { ...DEFAULT_SCHEDULING, ...(scheduling ?? {}) };
  const patch = (p: Partial<TaskScheduling>) => onChange({ ...s, ...p });

  const toggleWeekday = (v: number) => {
    const has = s.allowedWeekdays.includes(v);
    const next = has ? s.allowedWeekdays.filter((d) => d !== v) : [...s.allowedWeekdays, v].sort();
    patch({ allowedWeekdays: next });
  };

  return (
    <details className="space-y-3 border-t border-border pt-4">
      <summary className="cursor-pointer text-sm font-medium">
        {t("editor.scheduling.title")}
      </summary>

      <p className="text-[11px] text-muted-foreground">{t("editor.scheduling.hintContactTz")}</p>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>{t("editor.scheduling.preferredHour")}</Label>
          <Input
            type="number"
            min={0}
            max={23}
            value={s.preferredHour}
            onChange={(e) => patch({ preferredHour: Number(e.target.value) })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>{t("editor.scheduling.estimatedDuration")}</Label>
          <Input
            type="number"
            min={1}
            max={480}
            value={s.estimatedDurationMinutes}
            onChange={(e) => patch({ estimatedDurationMinutes: Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>{t("editor.scheduling.businessHoursStart")}</Label>
          <Input
            type="number"
            min={0}
            max={23}
            value={s.businessHours.start}
            onChange={(e) =>
              patch({ businessHours: { ...s.businessHours, start: Number(e.target.value) } })
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label>{t("editor.scheduling.businessHoursEnd")}</Label>
          <Input
            type="number"
            min={0}
            max={23}
            value={s.businessHours.end}
            onChange={(e) =>
              patch({ businessHours: { ...s.businessHours, end: Number(e.target.value) } })
            }
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>{t("editor.scheduling.allowedWeekdays")}</Label>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAY_OPTIONS.map(({ value, key }) => {
            const active = s.allowedWeekdays.includes(value);
            return (
              <button
                key={value}
                type="button"
                onClick={() => toggleWeekday(value)}
                className={`rounded-md border px-2 py-1 text-xs ${
                  active ? "border-brand-teal bg-brand-teal/10" : "border-border"
                }`}
              >
                {t(`editor.scheduling.weekdayShort.${key}`)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>{t("editor.scheduling.scheduledOffset")}</Label>
        <Input
          type="number"
          min={0}
          max={60}
          value={s.scheduledOffsetBusinessDays}
          onChange={(e) => patch({ scheduledOffsetBusinessDays: Number(e.target.value) })}
        />
        <p className="text-[11px] text-muted-foreground">{t("editor.scheduling.scheduledOffsetHint")}</p>
      </div>

      <div className="space-y-2 rounded-md border border-border bg-secondary/20 p-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={s.setDueAt}
            onChange={(e) => patch({ setDueAt: e.target.checked })}
          />
          {t("editor.scheduling.setDueAt")}
        </label>
        {s.setDueAt && (
          <>
            <div className="space-y-1.5">
              <Label>{t("editor.scheduling.dueOffset")}</Label>
              <Input
                type="number"
                min={0}
                max={60}
                value={s.dueOffsetBusinessDays}
                onChange={(e) => patch({ dueOffsetBusinessDays: Number(e.target.value) })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={s.dueAtAllDay}
                onChange={(e) => patch({ dueAtAllDay: e.target.checked })}
              />
              {t("editor.scheduling.dueAtAllDay")}
            </label>
          </>
        )}
      </div>
    </details>
  );
}

/**
 * Optional safety horizon (in days) before the sequence engine moves on if the
 * rep never closes the task this step creates. Default is "wait forever" —
 * advancement happens on the `sequences/task.completed` event. Setting a
 * timeout is useful for "give up after 2 weeks" patterns.
 */
function AwaitTimeoutField({
  value,
  onChange,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
}) {
  const t = useTranslations("pages.sequences");
  const enabled = value != null;
  return (
    <div className="space-y-1.5 rounded-md border border-border bg-secondary/20 p-2">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange(e.target.checked ? 14 : undefined)}
        />
        {t("editor.scheduling.awaitTimeoutEnabled")}
      </label>
      {enabled && (
        <div className="space-y-1.5">
          <Label>{t("editor.scheduling.awaitTimeoutDays")}</Label>
          <Input
            type="number"
            min={1}
            max={180}
            value={value}
            onChange={(e) => onChange(Number(e.target.value) || 1)}
          />
          <p className="text-[11px] text-muted-foreground">
            {t("editor.scheduling.awaitTimeoutHint")}
          </p>
        </div>
      )}
      {!enabled && (
        <p className="text-[11px] text-muted-foreground">
          {t("editor.scheduling.awaitTimeoutDisabledHint")}
        </p>
      )}
    </div>
  );
}

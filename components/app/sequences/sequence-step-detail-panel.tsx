"use client";

import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { LocalizedStringInput } from "./localized-string-input";
import { ConditionBuilder } from "./condition-builder";
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
} from "@/lib/sequences/types";

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
  otherSequences,
  orgMembers,
  onChange,
  onDelete,
  canDelete,
}: {
  step: DraftStep;
  otherSequences: { id: string; name: string }[];
  orgMembers: { id: string; name: string }[];
  onChange: (next: DraftStep) => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const t = useTranslations("pages.sequences");

  const patchConfig = (patch: Record<string, unknown>) =>
    onChange({ ...step, actionConfig: { ...step.actionConfig, ...patch } });

  const isMessage = step.actionType === "send_email" || step.actionType === "send_linkedin";
  const isAction =
    isMessage || step.actionType === "phone_call" || step.actionType === "update_contact" || step.actionType === "wait_delay" || step.actionType === "enroll_in_sequence";

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-4">
      {/* Step type is chosen at insertion (via the "+" palette) and is fixed —
          to change it, delete the step and add the right one. */}
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("editor.fields.actionType")}
        </p>
        <p className="text-sm font-semibold text-foreground">{t(`stepType.${step.actionType}`)}</p>
      </div>

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
            <LocalizedStringInput
              label={t("editor.fields.title")}
              value={cfg.titleTemplate}
              onChange={(v) => patchConfig({ titleTemplate: v })}
            />
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
                />
                <LocalizedStringInput
                  label={t("editor.fields.body")}
                  value={cfg.body}
                  onChange={(v) => patchConfig({ body: v })}
                  multiline
                />
              </>
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
              label={t("editor.fields.title")}
              value={cfg.titleTemplate}
              onChange={(v) => patchConfig({ titleTemplate: v })}
            />
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
                    {t(`contactStatus.${v}`)}
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
                    {t(`contactRole.${v}`)}
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
        };

        return (
          <div className="space-y-3">
            {branches.map((b, i) => (
              <div key={i} className="rounded-md border border-border p-2">
                <div className="mb-1.5 flex items-center justify-between">
                  <Label>{t("editor.switch.branch", { n: i + 1 })}</Label>
                  <button
                    type="button"
                    onClick={() => removeBranch(i)}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="remove branch"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
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

      {/* ----- Assignment (task-creating steps only) ----- */}
      {(isMessage || step.actionType === "phone_call") && (
        <AssignmentField
          assignment={(step.actionConfig as { assignment?: TaskAssignment }).assignment}
          orgMembers={orgMembers}
          onChange={(a) => patchConfig({ assignment: a })}
        />
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
  onChange,
}: {
  assignment: TaskAssignment | undefined;
  orgMembers: { id: string; name: string }[];
  onChange: (a: TaskAssignment) => void;
}) {
  const t = useTranslations("pages.sequences");
  const a: TaskAssignment = assignment ?? { actor: "sales", assignTo: "owner" };

  return (
    <div className="space-y-2 border-t border-border pt-4">
      <Label>{t("editor.assign.label")}</Label>
      {/* Sale / Agent — Agent disabled (acts on behalf of the rep, coming soon). */}
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
          disabled
          title={t("editor.comingSoon")}
          className="flex-1 cursor-not-allowed rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground opacity-50"
        >
          {t("editor.assign.agent")} ({t("editor.comingSoon")})
        </button>
      </div>

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

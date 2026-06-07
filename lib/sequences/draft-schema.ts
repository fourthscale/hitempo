import { z } from "zod";
import { SEQUENCE_STEP_ACTION_TYPES } from "./types";
import { SequencePredicateEvaluatorFactory } from "./predicates/predicate-evaluator-factory";
import { SequenceStepExecutorFactory } from "./step-executor-factory";

/**
 * Zod schema + graph validator for a sequence DRAFT definition.
 *
 * The draft is the editor's working copy (stored in `sequences.draft_definition`).
 * It uses author-chosen step ids (any non-empty string — typically a temp id
 * like "step-1") so nodes can cross-reference before real UUIDs exist. On
 * publish, the editing service validates with `validateDraftGraph`, remaps ids
 * to UUIDs, and writes `sequence_steps`.
 *
 * Validation is layered:
 *   1. `draftDefinitionSchema` — structural shape (Zod).
 *   2. `validateDraftGraph` — semantic integrity (refs, action_config per type,
 *      known predicate types, reachability). Returns structured issues so the
 *      editor can highlight the offending node.
 */

// ---------------------------------------------------------------------------
// LocalizedString
// ---------------------------------------------------------------------------

const localizedStringSchema = z.union([
  z.string(),
  z.record(z.string(), z.string()),
]);

// ---------------------------------------------------------------------------
// Predicate
// ---------------------------------------------------------------------------

const predicateSchema = z
  .object({
    type: z.string().min(1),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .nullable();

// ---------------------------------------------------------------------------
// next_step_ids
// ---------------------------------------------------------------------------

const nextStepIdsSchema = z
  .object({
    default: z.string().optional(),
    yes: z.string().optional(),
    no: z.string().optional(),
    cases: z.record(z.string(), z.string()).optional(),
  })
  .nullable();

// ---------------------------------------------------------------------------
// Step
// ---------------------------------------------------------------------------

export const draftStepSchema = z.object({
  id: z.string().min(1),
  stepOrder: z.number().int().min(0),
  actionType: z.enum(SEQUENCE_STEP_ACTION_TYPES),
  actionConfig: z.record(z.string(), z.unknown()).default({}),
  nextStepIds: nextStepIdsSchema.default(null),
  condition: predicateSchema.default(null),
  filter: predicateSchema.default(null),
});

export type DraftStep = z.infer<typeof draftStepSchema>;

export const draftDefinitionSchema = z.object({
  entryStepId: z.string().min(1),
  steps: z.array(draftStepSchema).min(1),
});

export type DraftDefinition = z.infer<typeof draftDefinitionSchema>;

// ---------------------------------------------------------------------------
// Semantic graph validation
// ---------------------------------------------------------------------------

export type DraftGraphIssue = {
  code:
    | "empty"
    | "duplicate_step_id"
    | "entry_not_found"
    | "dangling_reference"
    | "unknown_action_type"
    | "unknown_predicate_type"
    | "invalid_action_config"
    | "unreachable_step";
  stepId?: string;
  detail: string;
};

const MESSAGE_CHANNELS = ["email", "linkedin"] as const;
const MESSAGE_INTENTS = [
  "first_contact",
  "follow_up",
  "meeting_request",
  "proposal_send",
  "reconnect",
  "other",
] as const;

const taskAssignmentSchema = z
  .object({
    actor: z.enum(["sales", "agent"]),
    assignTo: z.enum(["owner", "specific"]),
    userId: z.string().optional(),
  })
  .optional();

/**
 * Per-step scheduling config — heures dans la TZ du contact, anti-conflit
 * et quotas appliqués à la création de la tâche. Voir lib/sequences/scheduling.ts.
 */
const taskSchedulingSchema = z
  .object({
    preferredHour: z.number().int().min(0).max(23).optional(),
    businessHours: z
      .object({
        start: z.number().int().min(0).max(23),
        end: z.number().int().min(0).max(23),
      })
      .optional(),
    allowedWeekdays: z.array(z.number().int().min(0).max(6)).optional(),
    estimatedDurationMinutes: z.number().int().positive().max(480).optional(),
    setScheduledFor: z.boolean().optional(),
    scheduledOffsetBusinessDays: z.number().int().min(0).max(60).optional(),
    setDueAt: z.boolean().optional(),
    dueOffsetBusinessDays: z.number().int().min(0).max(60).optional(),
    dueAtAllDay: z.boolean().optional(),
  })
  .optional();

// Days, capped at ~6 months so a typo can't park an enrolment forever
// (defeating the safety-net purpose). Omit to wait indefinitely.
const awaitTaskTimeoutDaysSchema = z.number().int().positive().max(180).optional();

const stepAttachmentSchema = z.object({
  storagePath: z.string().min(1),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
});

const sendMessageConfigSchema = z.object({
  mode: z.enum(["ai", "defined"]),
  channel: z.enum(MESSAGE_CHANNELS),
  intent: z.enum(MESSAGE_INTENTS),
  titleTemplate: localizedStringSchema,
  subject: localizedStringSchema.optional(),
  body: localizedStringSchema.optional(),
  orientation: localizedStringSchema.optional(),
  includeSignal: z.boolean().optional(),
  assignment: taskAssignmentSchema,
  scheduling: taskSchedulingSchema,
  awaitTaskTimeoutDays: awaitTaskTimeoutDaysSchema,
  /** Sprint 12 — pre-attached files. Empty / omitted = no attachments. */
  attachments: z.array(stepAttachmentSchema).optional(),
  /** Sprint 15 — email threading mode. Defaults to `new_thread` when
   *  omitted. The editor locks the first send_email step to `new_thread`. */
  threadingMode: z
    .enum(["new_thread", "last_email_step", "entry_email_step", "last_answered_step"])
    .optional(),
});

const phoneCallConfigSchema = z.object({
  titleTemplate: localizedStringSchema,
  description: localizedStringSchema.optional(),
  assignment: taskAssignmentSchema,
  scheduling: taskSchedulingSchema,
  awaitTaskTimeoutDays: awaitTaskTimeoutDaysSchema,
});

const waitDelayConfigSchema = z.object({
  durationValue: z.number().positive(),
  durationUnit: z.enum(["minutes", "hours", "days"]),
});

const enrollConfigSchema = z.object({
  targetSequenceId: z.string().uuid(),
  startAtStep: z.number().int().min(0).optional(),
});

const updateContactConfigSchema = z
  .object({
    setStatus: z.string().min(1).optional(),
    setRole: z.string().min(1).optional(),
  })
  .refine((v) => Boolean(v.setStatus || v.setRole), {
    message: "at least one field to update",
  });

const conditionLeafSchema = z.object({
  kind: z.literal("leaf"),
  dimension: z.string().min(1),
  operator: z.string().min(1),
  value: z.string().optional(),
  /** Slice E — only meaningful on behavior.* dimensions. */
  scope: z.enum(["any", "this_sequence"]).optional(),
});

type ConditionGroupShape = {
  kind: "group";
  op: "and" | "or";
  conditions: (z.infer<typeof conditionLeafSchema> | ConditionGroupShape)[];
};

const conditionGroupSchema: z.ZodType<ConditionGroupShape> = z.lazy(() =>
  z.object({
    kind: z.literal("group"),
    op: z.enum(["and", "or"]),
    conditions: z.array(z.union([conditionLeafSchema, conditionGroupSchema])),
  }),
);

const splitConfigSchema = z.object({
  condition: conditionGroupSchema,
});

const switchConfigSchema = z.object({
  branches: z.array(z.object({ condition: conditionGroupSchema })).min(1),
});

function issuesOf(r: { success: boolean; error?: { issues: { message: string }[] } }): string | null {
  return r.success ? null : (r.error?.issues.map((i) => i.message).join("; ") ?? "invalid");
}

function validateActionConfig(step: DraftStep): string | null {
  switch (step.actionType) {
    case "send_email":
    case "send_linkedin":
      return issuesOf(sendMessageConfigSchema.safeParse(step.actionConfig));
    case "phone_call":
      return issuesOf(phoneCallConfigSchema.safeParse(step.actionConfig));
    case "wait_delay":
      return issuesOf(waitDelayConfigSchema.safeParse(step.actionConfig));
    case "enroll_in_sequence":
      return issuesOf(enrollConfigSchema.safeParse(step.actionConfig));
    case "update_contact":
      return issuesOf(updateContactConfigSchema.safeParse(step.actionConfig));
    case "conditional_split":
      return issuesOf(splitConfigSchema.safeParse(step.actionConfig));
    case "conditional_switch":
      return issuesOf(switchConfigSchema.safeParse(step.actionConfig));
    case "merge":
      // Passthrough join node — no config to validate.
      return null;
  }
}

/** All step ids a step's nextStepIds points to. */
function referencedIds(step: DraftStep): string[] {
  const n = step.nextStepIds;
  if (!n) return [];
  const ids: string[] = [];
  if (n.default) ids.push(n.default);
  if (n.yes) ids.push(n.yes);
  if (n.no) ids.push(n.no);
  if (n.cases) ids.push(...Object.values(n.cases));
  return ids;
}

/**
 * Full semantic validation of a parsed draft. Returns an array of issues
 * (empty = publishable). Pure — no DB. Note `enroll_in_sequence.targetSequenceId`
 * existence is checked by the service against the DB (can't be done here).
 */
export function validateDraftGraph(draft: DraftDefinition): DraftGraphIssue[] {
  const issues: DraftGraphIssue[] = [];

  if (draft.steps.length === 0) {
    issues.push({ code: "empty", detail: "Sequence has no steps" });
    return issues;
  }

  // Duplicate ids.
  const byId = new Map<string, DraftStep>();
  for (const step of draft.steps) {
    if (byId.has(step.id)) {
      issues.push({ code: "duplicate_step_id", stepId: step.id, detail: `Duplicate step id ${step.id}` });
    }
    byId.set(step.id, step);
  }

  // Entry exists.
  if (!byId.has(draft.entryStepId)) {
    issues.push({ code: "entry_not_found", detail: `Entry step ${draft.entryStepId} not found` });
  }

  // Per-step checks.
  for (const step of draft.steps) {
    if (!SequenceStepExecutorFactory.isKnownActionType(step.actionType)) {
      issues.push({ code: "unknown_action_type", stepId: step.id, detail: step.actionType });
    }

    const configError = validateActionConfig(step);
    if (configError) {
      issues.push({ code: "invalid_action_config", stepId: step.id, detail: configError });
    }

    for (const pred of [step.condition, step.filter]) {
      if (pred && !SequencePredicateEvaluatorFactory.isKnownType(pred.type)) {
        issues.push({ code: "unknown_predicate_type", stepId: step.id, detail: pred.type });
      }
    }

    for (const ref of referencedIds(step)) {
      if (!byId.has(ref)) {
        issues.push({ code: "dangling_reference", stepId: step.id, detail: `points to missing ${ref}` });
      }
    }

    // Branch steps route both sides ; an unset branch defaults to the implicit
    // End, so no extra graph check is needed beyond config validation above.
  }

  // Reachability from entry (only when entry is valid).
  if (byId.has(draft.entryStepId)) {
    const reachable = new Set<string>();
    const stack = [draft.entryStepId];
    while (stack.length) {
      const id = stack.pop()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      const step = byId.get(id);
      if (step) {
        for (const ref of referencedIds(step)) {
          if (byId.has(ref)) stack.push(ref);
        }
      }
    }
    for (const step of draft.steps) {
      if (!reachable.has(step.id)) {
        issues.push({ code: "unreachable_step", stepId: step.id, detail: `${step.id} not reachable from entry` });
      }
    }
  }

  return issues;
}

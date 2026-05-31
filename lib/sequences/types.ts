/**
 * Shared types for the sequence engine (sprint 11, Phase A).
 *
 * The engine is graph-native and polymorphic : steps carry an `actionType`
 * + free-form `actionConfig`, navigate via `nextStepIds`, and gate on
 * `condition` / `filter` predicates. Concrete behaviour lives in Strategy
 * classes (predicate evaluators, step executors) resolved by Factories, so
 * Phase B/C extend by registration without touching the engine.
 *
 * These types are intentionally free of Drizzle row types where possible so
 * the pure logic (predicates, locale resolver) stays unit-testable without a
 * DB. The executor layer takes a `services` bag (injected by the engine) for
 * its side effects.
 */

import type { MessageChannel, MessageIntent } from "@/lib/messages/types";
import type { ConditionGroup } from "./conditions";
import type { TaskScheduling } from "./scheduling";

// ---------------------------------------------------------------------------
// Action types (mirror the DB enum ; kept here so non-DB code can import it)
// ---------------------------------------------------------------------------

export const SEQUENCE_STEP_ACTION_TYPES = [
  // Messages
  "send_email",
  "send_linkedin",
  // Field
  "phone_call",
  // Data
  "update_contact",
  // Logic
  "wait_delay",
  "conditional_split",
  "conditional_switch",
  "enroll_in_sequence",
  // Structural — a passthrough node where branches converge (join). No-op at
  // execution: the engine traverses straight to its `default`. Not in the
  // palette ; created by joining two branch ends in the editor.
  "merge",
] as const;

export type SequenceStepActionType = (typeof SEQUENCE_STEP_ACTION_TYPES)[number];

/** Palette grouping (mirrors Klaviyo's Messages / Field / Data / Logic). */
export const SEQUENCE_PALETTE_GROUPS: {
  group: "messages" | "field" | "data" | "logic";
  types: SequenceStepActionType[];
}[] = [
  { group: "messages", types: ["send_email", "send_linkedin"] },
  { group: "field", types: ["phone_call"] },
  { group: "data", types: ["update_contact"] },
  { group: "logic", types: ["wait_delay", "conditional_split", "conditional_switch", "enroll_in_sequence"] },
];

/** Step types that are not yet implemented end-to-end (shown disabled). */
export const SEQUENCE_COMING_SOON: SequenceStepActionType[] = ["send_linkedin"];

export type SequenceDelayUnit = "minutes" | "hours" | "days";

export type SequenceEndReason =
  | "exhausted"
  | "success"
  | "cascaded"
  | "opted_out"
  | "manual"
  | "safety_loop_cap_reached";

// ---------------------------------------------------------------------------
// LocalizedString — contact-facing text resolved against the contact's locale
// ---------------------------------------------------------------------------

/**
 * Either a plain string (locale-agnostic) or a per-locale map with an
 * optional `default`. Resolved at execution time against the contact /
 * company / org locale chain — see lib/sequences/locale-resolver.ts.
 */
export type LocalizedString =
  | string
  | ({ default?: string } & { [locale: string]: string | undefined });

// ---------------------------------------------------------------------------
// next_step_ids — graph navigation
// ---------------------------------------------------------------------------

/**
 * Where the engine goes after a step. Phase A only ever sets `default`
 * (linear) or leaves it null (terminal). Phase B adds `yes`/`no` (conditional
 * split) and `cases`/`default` (switch). The engine looks up the key the
 * executor returns via `navigateTo`.
 */
export type NextStepIds = {
  default?: string;
  yes?: string;
  no?: string;
  cases?: Record<string, string>;
} | null;

// ---------------------------------------------------------------------------
// Predicates (condition / filter)
// ---------------------------------------------------------------------------

export type SequencePredicate = {
  type: string;
  config?: Record<string, unknown>;
} | null;

// ---------------------------------------------------------------------------
// action_config shapes (Phase A)
// ---------------------------------------------------------------------------

/**
 * Who the created task is assigned to.
 *  - actor : 'sales' (a human rep handles it) or 'agent' (the AI handles it,
 *    acting on behalf of the resolved rep — task still owned by that rep, flagged
 *    auto). 'agent' is not wired yet (UI disabled).
 *  - assignTo : 'owner' (contact owner → company owner → enroller fallback) or
 *    'specific' (a chosen org member).
 */
export type TaskAssignment = {
  actor: "sales" | "agent";
  assignTo: "owner" | "specific";
  userId?: string; // when assignTo === 'specific'
};

/** "ai" → generate a draft on task open ; "defined" → use the stored subject/body. */
export type MessageMode = "ai" | "defined";

/** send_email / send_linkedin. The step creates a task ; the message is either
 *  AI-generated (deferred to on-open) or a defined localized body. */
export type SendMessageActionConfig = {
  mode: MessageMode;
  channel: MessageChannel;
  intent: MessageIntent;
  titleTemplate: LocalizedString;
  /** defined mode. */
  subject?: LocalizedString;
  body?: LocalizedString;
  /** ai mode. */
  orientation?: LocalizedString;
  includeSignal?: boolean;
  assignment?: TaskAssignment;
  /** TZ-contact heures, anti-conflit & quotas. Voir lib/sequences/scheduling.ts. */
  scheduling?: TaskScheduling;
  /**
   * Safety horizon (in days) before the engine moves on if the rep never
   * closes the created task. Omit (default) to wait forever — the engine
   * will only resume on the `sequences/task.completed` event.
   */
  awaitTaskTimeoutDays?: number;
};

/** phone_call — a manual call task, no message. */
export type PhoneCallActionConfig = {
  titleTemplate: LocalizedString;
  description?: LocalizedString;
  assignment?: TaskAssignment;
  /** TZ-contact heures, anti-conflit & quotas. Voir lib/sequences/scheduling.ts. */
  scheduling?: TaskScheduling;
  /** See SendMessageActionConfig.awaitTaskTimeoutDays. */
  awaitTaskTimeoutDays?: number;
};

export type WaitDelayActionConfig = {
  durationValue: number;
  durationUnit: SequenceDelayUnit;
};

export type EnrollInSequenceActionConfig = {
  targetSequenceId: string;
  startAtStep?: number;
};

/** Fields the update_contact step may set (limited, safe subset). */
export type UpdateContactActionConfig = {
  setStatus?: string; // contacts.status
  setRole?: string; // contacts.role
};

/**
 * conditional_split — if/else. The YES side moves contacts matching `condition`
 * to `next_step_ids.yes` ; everyone else (the implicit ELSE) to `next_step_ids.no`.
 */
export type ConditionalSplitActionConfig = {
  condition: ConditionGroup;
};

/**
 * conditional_switch — ordered if/elif/else ladder. Branch `i` matches when its
 * `condition` is the first to evaluate true ; routes to `next_step_ids.cases["i"]`.
 * No branch matches → `next_step_ids.default`.
 */
export type ConditionalSwitchActionConfig = {
  branches: { condition: ConditionGroup }[];
};

export type SequenceStepActionConfig =
  | SendMessageActionConfig
  | PhoneCallActionConfig
  | WaitDelayActionConfig
  | EnrollInSequenceActionConfig
  | UpdateContactActionConfig
  | ConditionalSplitActionConfig
  | ConditionalSwitchActionConfig
  | Record<string, never>;

// ---------------------------------------------------------------------------
// Minimal entity shapes the engine + predicates need (locale chain, etc.)
// ---------------------------------------------------------------------------

export type SequenceContactCtx = {
  id: string;
  kind: "person" | "generic";
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  preferredLanguage: string;
  optedOut: boolean;
  status: string | null;
  role: string | null;
  ownerId: string | null;
};

export type SequenceCompanyCtx = {
  id: string;
  name: string;
  primaryLocale: string;
  relationshipType: string | null;
  signalType: string | null;
  signalDetectedAt: Date | null;
  ownerId: string | null;
};

export type SequenceOrgCtx = {
  id: string;
  defaultLocale: string;
};

export type SequenceEnrolmentCtx = {
  id: string;
  organizationId: string;
  sequenceId: string;
  companyId: string;
  contactId: string;
  assigneeId: string | null;
  currentStepId: string;
  currentStepOrder: number;
  lastExecutionCounter: number;
  maxExecutionCount: number;
};

export type SequenceStepCtx = {
  id: string;
  stepOrder: number;
  actionType: SequenceStepActionType;
  actionConfig: SequenceStepActionConfig;
  nextStepIds: NextStepIds;
  condition: SequencePredicate;
  filter: SequencePredicate;
};

// ---------------------------------------------------------------------------
// Interaction shape predicates read (history-based conditions)
// ---------------------------------------------------------------------------

export type SequenceInteractionCtx = {
  id: string;
  type: string; // interactionType — 'email_received' etc.
  outcome: string | null;
  status: string | null; // interactionStatus — 'sent' | 'responded' | ...
  occurredAt: Date;
};

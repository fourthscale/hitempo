/**
 * Typed error hierarchy for the sequence engine (sprint 11).
 *
 * Engine/domain-level errors live here. Action-layer user-facing errors
 * (lock held, draft invalid, …) live in lib/actions/sequence-action-errors.ts
 * and extend UserFacingActionError so the global modal can surface them.
 */

export abstract class SequenceError extends Error {
  abstract readonly code: string;
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** A predicate jsonb references a `type` not registered in the factory. */
export class UnknownPredicateTypeError extends SequenceError {
  readonly code = "UNKNOWN_PREDICATE_TYPE";
  constructor(public readonly predicateType: string) {
    super(`Unknown sequence predicate type: "${predicateType}"`);
  }
}

/** A step's `actionType` has no registered executor. */
export class UnknownActionTypeError extends SequenceError {
  readonly code = "UNKNOWN_ACTION_TYPE";
  constructor(public readonly actionType: string) {
    super(`Unknown sequence step action type: "${actionType}"`);
  }
}

/** An executor received an `action_config` shape it can't process. */
export class InvalidActionConfigError extends SequenceError {
  readonly code = "INVALID_ACTION_CONFIG";
  constructor(public readonly actionType: string, reason: string) {
    super(`Invalid action_config for "${actionType}": ${reason}`);
  }
}

import { UnknownPredicateTypeError } from "../sequence-errors";
import type { SequencePredicate } from "../types";
import {
  type PredicateEvaluationContext,
  type SequencePredicateEvaluator,
  AlwaysEvaluator,
  IfNoInboundEvaluator,
  IfRespondedEvaluator,
  IfPositiveReplyEvaluator,
  IfNegativeReplyEvaluator,
  IfNoAnswerEvaluator,
  CompositePredicateEvaluator,
} from "./predicate-evaluator";

/**
 * Maps a predicate `type` string to its evaluator. New predicate types
 * (Phase B/C : property / time / composite) register here — the engine
 * never changes.
 *
 * A `null` predicate means "always true" (no condition / no filter), which
 * the static `evaluate` helper short-circuits before touching the registry.
 */
export class SequencePredicateEvaluatorFactory {
  private static readonly registry: Map<string, SequencePredicateEvaluator> = new Map(
    [
      new AlwaysEvaluator(),
      new IfNoInboundEvaluator(),
      new IfRespondedEvaluator(),
      new IfPositiveReplyEvaluator(),
      new IfNegativeReplyEvaluator(),
      new IfNoAnswerEvaluator(),
      new CompositePredicateEvaluator(),
    ].map((e) => [e.type, e]),
  );

  /** Returns the evaluator for a type or throws UnknownPredicateTypeError. */
  static forType(type: string): SequencePredicateEvaluator {
    const evaluator = this.registry.get(type);
    if (!evaluator) throw new UnknownPredicateTypeError(type);
    return evaluator;
  }

  /** True if a type is registered — used by publish-time validation. */
  static isKnownType(type: string): boolean {
    return this.registry.has(type);
  }

  /**
   * Evaluates a (possibly null) predicate. null → true (no gate).
   * Throws UnknownPredicateTypeError for an unregistered type.
   */
  static evaluate(predicate: SequencePredicate, ctx: PredicateEvaluationContext): boolean {
    if (predicate == null) return true;
    return this.forType(predicate.type).evaluate(ctx, predicate.config);
  }
}

import type { DraftDefinition, DraftStep } from "./draft-schema";
import type { NextStepIds } from "./types";

/**
 * Pure structural-edit helpers for the sequence draft graph.
 *
 * The draft is a DAG navigated by `next_step_ids` (default / yes / no / cases).
 * Structural edits (deleting a step, removing a switch branch) can leave steps
 * that are no longer reachable from the entry — "orphan islands" the editor
 * can't render an insert-point for, so the user gets stuck. These helpers keep
 * the graph connected and heal linear chains on delete.
 */

/** Read the target of one named slot ("default" | "yes" | "no" | "case:N"). */
export function targetForSlot(next: NextStepIds, slot: string): string | undefined {
  if (!next) return undefined;
  if (slot === "default") return next.default;
  if (slot === "yes") return next.yes;
  if (slot === "no") return next.no;
  if (slot.startsWith("case:")) return next.cases?.[slot.slice(5)];
  return undefined;
}

/** All target step ids referenced by a step's next slots. */
function targetsOf(next: NextStepIds): string[] {
  if (!next) return [];
  return [
    next.default,
    next.yes,
    next.no,
    ...(next.cases ? Object.values(next.cases) : []),
  ].filter((v): v is string => typeof v === "string");
}

/** Set of step ids reachable from the entry, following every next slot. */
export function reachableStepIds(steps: DraftStep[], entryId: string): Set<string> {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const stack = byId.has(entryId) ? [entryId] : [];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const t of targetsOf(byId.get(id)?.nextStepIds ?? null)) {
      if (byId.has(t) && !seen.has(t)) stack.push(t);
    }
  }
  return seen;
}

/**
 * Drop steps no longer reachable from the entry. Run after any structural
 * mutation so the graph can never hold a disconnected island. A step pointed
 * to from several branches (a merge) survives as long as one path remains.
 */
export function gcUnreachableSteps(draft: DraftDefinition): DraftDefinition {
  const reachable = reachableStepIds(draft.steps, draft.entryStepId);
  if (reachable.size === draft.steps.length) return draft;
  return { ...draft, steps: draft.steps.filter((s) => reachable.has(s.id)) };
}

/**
 * Replace every reference to `deletedId` across all steps. With a `replacement`
 * the reference is re-pointed (heals a chain: predecessors skip to the deleted
 * step's continuation); without one the slot is removed (→ End).
 */
/**
 * Delete a step while keeping one of its outgoing paths. Predecessors of the
 * deleted step are re-pointed to the kept path's target (the kept subtree is
 * spliced into the deleted step's position); every other path becomes
 * unreachable and is GC'd. With `keepSlot = null` no path is kept (predecessors
 * collapse to End) — i.e. "delete everything below this branch".
 *
 * This is how a conditional (split / switch) is removed without nuking the
 * surviving branch : the user chooses which path lives on.
 */
export function deleteStepKeepingPath(
  draft: DraftDefinition,
  stepId: string,
  keepSlot: string | null,
): DraftDefinition {
  const step = draft.steps.find((s) => s.id === stepId);
  const promote = step && keepSlot ? targetForSlot(step.nextStepIds, keepSlot) : undefined;
  const remaining = draft.steps.filter((s) => s.id !== stepId);
  const steps = repointRefs(remaining, stepId, promote);
  // If the deleted step was the entry, the kept path's first step becomes the
  // new entry ; with no kept path the sequence is left empty.
  const entryStepId = stepId === draft.entryStepId ? (promote ?? "") : draft.entryStepId;
  return gcUnreachableSteps({ entryStepId, steps });
}

/** Step types that carry a single linear continuation and can be dragged. */
export function isMovableStep(actionType: DraftStep["actionType"]): boolean {
  return (
    actionType !== "conditional_split" &&
    actionType !== "conditional_switch" &&
    actionType !== "merge"
  );
}

/** Set / clear one named slot on a nextStepIds object, returning a new one. */
function withSlot(next: NextStepIds, slot: string, target: string | undefined): NextStepIds {
  const n: NonNullable<NextStepIds> = { ...(next ?? {}) };
  if (slot === "default" || slot === "yes" || slot === "no") {
    if (target) n[slot] = target;
    else delete n[slot];
  } else if (slot.startsWith("case:")) {
    const key = slot.slice(5);
    const cases = { ...(n.cases ?? {}) };
    if (target) cases[key] = target;
    else delete cases[key];
    if (Object.keys(cases).length) n.cases = cases;
    else delete n.cases;
  }
  return Object.keys(n).length ? n : null;
}

/** True if the graph reachable from the entry contains a cycle. */
function hasCycle(steps: DraftStep[], entryId: string): boolean {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const state = new Map<string, 0 | 1>(); // 0 = visiting, 1 = done
  const visit = (id: string): boolean => {
    if (!byId.has(id)) return false;
    const st = state.get(id);
    if (st === 0) return true;
    if (st === 1) return false;
    state.set(id, 0);
    for (const t of targetsOf(byId.get(id)!.nextStepIds)) {
      if (visit(t)) return true;
    }
    state.set(id, 1);
    return false;
  };
  return visit(entryId);
}

/**
 * Move a linear step to a new position : the "+" leaving `destSource` via
 * `destSlot` (a null `destSource` means the entry/trigger). The step is first
 * detached (predecessors heal to its continuation), then spliced in at the
 * destination, continuing to whatever was there.
 *
 * Returns the new draft, or null when the move is a no-op or illegal (the step
 * isn't movable, or the move would create a cycle — e.g. dropping a step into
 * its own downstream).
 */
export function moveStep(
  draft: DraftDefinition,
  stepId: string,
  destSource: string | null,
  destSlot: string,
): DraftDefinition | null {
  const step = draft.steps.find((s) => s.id === stepId);
  if (!step || !isMovableStep(step.actionType)) return null;
  if (destSource === stepId) return null; // can't land on its own outgoing edge

  // Already at this position ? (the destination slot already targets the step)
  const destBefore =
    destSource === null
      ? draft.entryStepId
      : targetForSlot(draft.steps.find((s) => s.id === destSource)?.nextStepIds ?? null, destSlot);
  if (destBefore === stepId) return null;

  const cont = step.nextStepIds?.default;

  // 1. Detach : everyone pointing at the step now points to its continuation.
  let steps = repointRefs(draft.steps, stepId, cont);
  let entryStepId = draft.entryStepId === stepId ? (cont ?? "") : draft.entryStepId;

  // 2. Destination's current target, recomputed after the detach.
  const destTarget =
    destSource === null
      ? entryStepId
      : targetForSlot(steps.find((s) => s.id === destSource)?.nextStepIds ?? null, destSlot);

  // 3. Splice the step in : it continues to what the destination pointed at.
  steps = steps.map((s) =>
    s.id === stepId ? { ...s, nextStepIds: withSlot(s.nextStepIds, "default", destTarget) } : s,
  );
  if (destSource === null) {
    entryStepId = stepId;
  } else {
    steps = steps.map((s) =>
      s.id === destSource ? { ...s, nextStepIds: withSlot(s.nextStepIds, destSlot, stepId) } : s,
    );
  }

  if (hasCycle(steps, entryStepId)) return null;
  return gcUnreachableSteps({ entryStepId, steps });
}

/**
 * Join two open branch ends : create a `merge` passthrough node and point both
 * ends at it, so the branches converge and share the downstream path. The two
 * ends must be open (no current target) — joins are only offered on End
 * terminals. `mergeId` is supplied by the caller (editor id scheme).
 *
 * Returns null when the join is a no-op (same end) or would create a cycle.
 */
export function joinBranches(
  draft: DraftDefinition,
  mergeId: string,
  aSource: string,
  aSlot: string,
  bSource: string,
  bSlot: string,
): DraftDefinition | null {
  if (aSource === bSource && aSlot === bSlot) return null;

  const mergeStep: DraftStep = {
    id: mergeId,
    stepOrder: 0,
    actionType: "merge",
    actionConfig: {},
    nextStepIds: null,
    condition: null,
    filter: null,
  };

  const steps = [...draft.steps, mergeStep].map((s) => {
    if (s.id === aSource && s.id === bSource) {
      // Both ends belong to the same step (e.g. a split's yes + no).
      return { ...s, nextStepIds: withSlot(withSlot(s.nextStepIds, aSlot, mergeId), bSlot, mergeId) };
    }
    if (s.id === aSource) return { ...s, nextStepIds: withSlot(s.nextStepIds, aSlot, mergeId) };
    if (s.id === bSource) return { ...s, nextStepIds: withSlot(s.nextStepIds, bSlot, mergeId) };
    return s;
  });

  if (hasCycle(steps, draft.entryStepId)) return null;
  return gcUnreachableSteps({ ...draft, steps });
}

/**
 * Undo a join : remove the merge node and re-open the branches that fed it.
 * The merge's continuation (if any post-merge steps exist) stays attached to
 * the first feeder ; the other feeders become open ends again. With no
 * continuation (the common case) every feeder simply re-opens.
 */
export function unmergeStep(draft: DraftDefinition, mergeId: string): DraftDefinition {
  const merge = draft.steps.find((s) => s.id === mergeId);
  if (!merge || merge.actionType !== "merge") return draft;
  const cont = merge.nextStepIds?.default;

  // Feeders (step + slot pointing at the merge), in deterministic order.
  const feeders: { id: string; slot: string }[] = [];
  for (const s of draft.steps) {
    const n = s.nextStepIds;
    if (!n) continue;
    for (const slot of ["default", "yes", "no"] as const) {
      if (n[slot] === mergeId) feeders.push({ id: s.id, slot });
    }
    if (n.cases) {
      for (const [k, v] of Object.entries(n.cases)) {
        if (v === mergeId) feeders.push({ id: s.id, slot: `case:${k}` });
      }
    }
  }
  const replacement = new Map<string, string | undefined>();
  feeders.forEach((f, i) => replacement.set(`${f.id}|${f.slot}`, i === 0 ? cont : undefined));

  const steps = draft.steps
    .filter((s) => s.id !== mergeId)
    .map((s) => {
      const mine = feeders.filter((f) => f.id === s.id);
      if (mine.length === 0) return s;
      let next = s.nextStepIds;
      for (const f of mine) next = withSlot(next, f.slot, replacement.get(`${f.id}|${f.slot}`));
      return { ...s, nextStepIds: next };
    });

  const entryStepId = mergeId === draft.entryStepId ? (cont ?? "") : draft.entryStepId;
  return gcUnreachableSteps({ entryStepId, steps });
}

export function repointRefs(
  steps: DraftStep[],
  deletedId: string,
  replacement: string | undefined,
): DraftStep[] {
  const fix = (v: string | undefined): string | undefined =>
    v === deletedId ? replacement : v;

  return steps.map((s) => {
    if (!s.nextStepIds) return s;
    const n: NonNullable<NextStepIds> = { ...s.nextStepIds };

    for (const slot of ["default", "yes", "no"] as const) {
      if (n[slot] === deletedId) {
        const next = fix(n[slot]);
        if (next) n[slot] = next;
        else delete n[slot];
      }
    }

    if (n.cases) {
      const entries = Object.entries(n.cases)
        .map(([k, v]) => [k, fix(v)] as const)
        .filter((e): e is readonly [string, string] => e[1] != null);
      n.cases = Object.fromEntries(entries);
      if (Object.keys(n.cases).length === 0) delete n.cases;
    }

    return { ...s, nextStepIds: Object.keys(n).length ? n : null };
  });
}

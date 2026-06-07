import type { DraftDefinition } from "./draft-schema";

/**
 * True when `stepId` is the FIRST `send_email` step the engine can reach
 * along ANY path from the entry node.
 *
 * Used by the editor (sequence-step-detail-panel) to lock `threadingMode`
 * to `new_thread` on the first email step — there's no previous thread
 * to reply into.
 *
 * Semantics (matters for conditional_split branches) : a step counts as
 * "first" iff EVERY path from entry to it has zero prior `send_email`.
 * If even one path passes through a prior send_email, the step is NOT
 * first — Threading must be available because the engine could legitimately
 * reach it after a prior email send.
 *
 * BFS implementation : each frontier entry tracks "did this path already
 * pass a send_email" as part of its state ; visit-with-flag dedup so the
 * same node reached with `sawSend=true` is a different visit than
 * `sawSend=false` (we'd lose the "already saw email" signal otherwise).
 *
 * Pure : no React, no I/O. Tested in `tests/sequences/is-first-send-email-step.test.ts`.
 */
export function isFirstSendEmailStep(draft: DraftDefinition, stepId: string): boolean {
  if (!draft.entryStepId) return true;
  const byId = new Map(draft.steps.map((s) => [s.id, s] as const));
  const target = byId.get(stepId);
  if (!target || target.actionType !== "send_email") return true;

  const visited = new Set<string>();
  type Frame = { id: string; sawSend: boolean };
  const queue: Frame[] = [{ id: draft.entryStepId, sawSend: false }];

  while (queue.length > 0) {
    const f = queue.shift()!;
    const key = `${f.id}#${f.sawSend ? "1" : "0"}`;
    if (visited.has(key)) continue;
    visited.add(key);

    if (f.id === stepId) {
      // Reached the target via a path that already had a prior send_email
      // → not the first. Bail with `false` immediately.
      if (f.sawSend) return false;
      // Otherwise keep exploring : another path might still find a prior
      // send_email reaching the same target via a different branch.
      continue;
    }
    const node = byId.get(f.id);
    if (!node) continue;
    const nextSaw = f.sawSend || node.actionType === "send_email";
    const next = node.nextStepIds;
    if (!next) continue;
    const targets: string[] = [];
    if (next.default) targets.push(next.default);
    if (next.yes) targets.push(next.yes);
    if (next.no) targets.push(next.no);
    if (next.cases) targets.push(...Object.values(next.cases));
    for (const t of targets) {
      if (byId.has(t)) queue.push({ id: t, sawSend: nextSaw });
    }
  }
  return true;
}

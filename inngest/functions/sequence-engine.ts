import { inngest } from "@/lib/inngest/client";
import { SequenceEngineFactory } from "@/lib/sequences/engine/sequence-engine-factory";
import {
  EVENT_ADVANCE,
  EVENT_TASK_COMPLETED,
  EVENT_OUTCOME_QUALIFIED,
} from "@/lib/sequences/engine/events";
import { listParkedEnrolmentIdsForContact } from "@/db/queries/sequence-enrolments";
import { getAdminDb } from "@/db/client";

/**
 * Sequence engine Inngest wiring.
 *
 *  - `sequence-tick` (cron) : sweeps due enrolments across all orgs and fans
 *    out one `sequences/advance` event per enrolment. Two cadences — every
 *    15 min on weekday business hours, hourly otherwise — mirroring the Gmail
 *    poller's cost model. Keeps each tick to 1 + N cheap steps.
 *
 *  - `sequence-advance-enrolment` : per-enrolment handler. Triggered by the
 *    tick AND by `sequences/task.completed` (emitted when a sequence-generated
 *    task is closed), so the next step schedules immediately without waiting
 *    for the next cron. Idempotent on (enrolment_id, execution_counter), so a
 *    duplicate event / retry can't double-execute a step.
 *
 * Local dev : run `npx inngest-cli@latest dev` next to `npm run dev`.
 */

const TICK_ID = "sequences/tick";

async function handleTick({ step }: { step: import("inngest").GetStepTools<typeof inngest> }) {
  const enrolmentIds = await step.run("list-due-enrolments", async () => {
    return SequenceEngineFactory.getInstance().getDueEnrolmentIds(500);
  });

  if (enrolmentIds.length === 0) return { due: 0 };

  await step.sendEvent(
    "fan-out-advance",
    enrolmentIds.map((enrolmentId) => ({
      name: EVENT_ADVANCE,
      data: { enrolmentId },
    })),
  );
  return { due: enrolmentIds.length };
}

const tickBusinessHours = inngest.createFunction(
  {
    id: `${TICK_ID}-weekday-business`,
    name: "Sequence tick — weekday business hours",
    triggers: [{ cron: "TZ=Europe/Paris */15 8-19 * * 1-5" }],
  },
  handleTick,
);

const tickOffHours = inngest.createFunction(
  {
    id: `${TICK_ID}-offhours`,
    name: "Sequence tick — off hours + weekends",
    triggers: [{ cron: "TZ=Europe/Paris 0 0-7,20-23 * * 1-5" }, { cron: "TZ=Europe/Paris 0 * * * 0,6" }],
  },
  handleTick,
);

async function handleAdvance({
  event,
  step,
}: {
  event: { data: { enrolmentId: string } };
  step: import("inngest").GetStepTools<typeof inngest>;
}) {
  const enrolmentId = event.data.enrolmentId;
  return step.run("advance", async () => {
    return SequenceEngineFactory.getInstance().advanceEnrolment(enrolmentId);
  });
}

const advanceEnrolment = inngest.createFunction(
  {
    id: "sequences/advance-enrolment",
    name: "Sequence — advance one enrolment",
    // Light concurrency cap : one in-flight run per enrolment avoids two ticks
    // racing the same enrolment (the idempotence UNIQUE is the hard guard).
    concurrency: { key: "event.data.enrolmentId", limit: 1 },
    triggers: [{ event: EVENT_ADVANCE }],
  },
  handleAdvance,
);

const advanceOnTaskCompleted = inngest.createFunction(
  {
    id: "sequences/advance-on-task-completed",
    name: "Sequence — advance on task completed",
    concurrency: { key: "event.data.enrolmentId", limit: 1 },
    triggers: [{ event: EVENT_TASK_COMPLETED }],
  },
  handleAdvance,
);

/**
 * Slice D — handler for `sequences/outcome.qualified`.
 *
 * Fires when an interaction's outcome flips from null (LLM auto-apply,
 * sale confirms in the inbox, or the manual outcome menu). Fans out one
 * `sequences/advance` per parked enrolment on that contact so the engine
 * re-evaluates the outcome-dependent branch with the now-qualified facts.
 *
 * Idempotency : safe — extra advances on already-active or already-ended
 * enrolments are no-ops (the engine's first guard rejects non-active).
 */
async function handleOutcomeQualified({
  event,
  step,
}: {
  event: { data: { organizationId: string; contactId: string } };
  step: import("inngest").GetStepTools<typeof inngest>;
}) {
  const { organizationId, contactId } = event.data;

  const enrolmentIds = await step.run("list-parked", async () => {
    return listParkedEnrolmentIdsForContact(getAdminDb(), organizationId, contactId);
  });

  if (enrolmentIds.length === 0) return { woken: 0 };

  await step.sendEvent(
    "fan-out-advance-on-outcome",
    enrolmentIds.map((enrolmentId) => ({
      name: EVENT_ADVANCE,
      data: { enrolmentId },
    })),
  );
  return { woken: enrolmentIds.length };
}

const wakeOnOutcomeQualified = inngest.createFunction(
  {
    id: "sequences/wake-on-outcome-qualified",
    name: "Sequence — wake parked enrolments on outcome qualified",
    triggers: [{ event: EVENT_OUTCOME_QUALIFIED }],
  },
  handleOutcomeQualified,
);

export const sequenceEngineFunctions = [
  tickBusinessHours,
  tickOffHours,
  advanceEnrolment,
  advanceOnTaskCompleted,
  wakeOnOutcomeQualified,
];

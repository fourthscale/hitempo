import { addDays } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { getWorkPatternWindowsForDay, type WorkPattern } from "./work-pattern";

/**
 * Anti-conflict + per-day quota slot finder for the sale's agenda.
 *
 * Given a "desired" moment (already TZ-aware, computed from contact's
 * preferences via `computeTaskSchedule`), find the actual moment the task
 * will be inserted at, respecting :
 *
 *  - the sale's `work_pattern` windows in the sale's TZ
 *  - the per-day quota per task type (max emails/day, max calls/day)
 *  - non-overlap with other tasks already on the sale's agenda
 *    (5-min buffer between consecutive tasks)
 *
 * If no slot fits within 14 days → `NoFreeSlotError`.
 *
 * The work pattern is a HINT, not a hard block — if the day has no working
 * windows the day is skipped, but inside a working day we always find the
 * first available cursor and don't fail.
 */

const BUFFER_MIN = 5;
const SEARCH_HORIZON_DAYS = 14;

export type TaskTypeKey = "email" | "phone" | "linkedin" | "visit" | "research" | "other";

export type ExistingTask = {
  scheduledFor: Date;
  estimatedDurationMinutes: number;
  type: TaskTypeKey;
};

export type SaleMember = {
  timezone: string;
  workPattern: WorkPattern;
  maxEmailsPerDay: number;
  maxCallsPerDay: number;
};

export class NoFreeSlotError extends Error {
  constructor(msg = "No free slot found within 14 days") {
    super(msg);
    this.name = "NoFreeSlotError";
  }
}

function quotaForType(type: TaskTypeKey, m: SaleMember): number | null {
  switch (type) {
    case "email":
      return m.maxEmailsPerDay;
    case "phone":
      return m.maxCallsPerDay;
    default:
      // No quota → never saturate the day for this type.
      return null;
  }
}

function isSameDayInTz(a: Date, b: Date, tz: string): boolean {
  const za = toZonedTime(a, tz);
  const zb = toZonedTime(b, tz);
  return (
    za.getFullYear() === zb.getFullYear() &&
    za.getMonth() === zb.getMonth() &&
    za.getDate() === zb.getDate()
  );
}

/**
 * @param desired       — preferred moment (output of computeTaskSchedule)
 * @param durationMin   — duration to reserve
 * @param taskType      — used for quota lookup
 * @param member        — sale's TZ + work pattern + quotas
 * @param existingTasks — tasks already on the sale's agenda (any window)
 */
export function findNextFreeSlot(
  desired: Date,
  durationMin: number,
  taskType: TaskTypeKey,
  member: SaleMember,
  existingTasks: ExistingTask[],
): Date {
  // Iterate candidate calendar days starting at `desired`'s day in saleTz.
  for (let dayOffset = 0; dayOffset < SEARCH_HORIZON_DAYS; dayOffset++) {
    const candidate = addDays(desired, dayOffset);

    // Quota check : count tasks of this type already on this day.
    const quota = quotaForType(taskType, member);
    if (quota !== null) {
      const count = existingTasks.filter(
        (t) => t.type === taskType && isSameDayInTz(t.scheduledFor, candidate, member.timezone),
      ).length;
      if (count >= quota) continue;
    }

    // Work pattern windows for this day in sale TZ.
    const windows = getWorkPatternWindowsForDay(member.workPattern, candidate, member.timezone);
    if (windows.length === 0) continue;

    // Tasks falling on this day (ordered by start time) — only those we
    // need to check for conflict.
    const sameDayTasks = existingTasks
      .filter((t) => isSameDayInTz(t.scheduledFor, candidate, member.timezone))
      .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime());

    for (const win of windows) {
      // Start cursor : on the desired day, never go before `desired`.
      let cursor = win.startUtc;
      if (dayOffset === 0 && desired.getTime() > cursor.getTime()) {
        cursor = desired;
      }

      const slotMs = durationMin * 60_000;
      const bufMs = BUFFER_MIN * 60_000;

      while (cursor.getTime() + slotMs <= win.endUtc.getTime()) {
        const slotEnd = cursor.getTime() + slotMs;
        const conflict = sameDayTasks.find((t) => {
          const tStart = t.scheduledFor.getTime();
          const tEnd = tStart + t.estimatedDurationMinutes * 60_000;
          // Overlap iff slotStart < tEnd AND tStart < slotEnd
          return cursor.getTime() < tEnd && tStart < slotEnd;
        });
        if (!conflict) return cursor;

        // Skip past the conflict + buffer.
        const conflictEnd =
          conflict.scheduledFor.getTime() + conflict.estimatedDurationMinutes * 60_000;
        cursor = new Date(conflictEnd + bufMs);
      }
    }
  }

  throw new NoFreeSlotError();
}

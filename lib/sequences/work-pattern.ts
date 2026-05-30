import { fromZonedTime, toZonedTime } from "date-fns-tz";

/**
 * Work pattern : the windows a sale is reachable / can be scheduled, by
 * day of week. Times are stored as `"HH:MM"` strings (24h). Each day can
 * have multiple windows (e.g. 09:00–12:00 + 14:00–17:00).
 *
 * Phase A : single pattern shared across task types. Phase B may add a
 * `byType` extension for type-specific windows (call vs email vs visit).
 */

export type TimeOfDay = `${string}:${string}`;
export type TimeWindow = { start: TimeOfDay; end: TimeOfDay };

export type WorkPatternDayKey =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";

export type WorkPattern = Partial<Record<WorkPatternDayKey, TimeWindow[]>>;

const WEEKDAY_DEFAULT: TimeWindow[] = [
  { start: "09:00", end: "12:00" },
  { start: "14:00", end: "17:00" },
];

/**
 * Default work pattern : 9-12 + 14-17 on weekdays, nothing on weekends.
 * Applied when a member has no `work_pattern` saved.
 */
export const DEFAULT_WORK_PATTERN: WorkPattern = {
  monday: WEEKDAY_DEFAULT,
  tuesday: WEEKDAY_DEFAULT,
  wednesday: WEEKDAY_DEFAULT,
  thursday: WEEKDAY_DEFAULT,
  friday: WEEKDAY_DEFAULT,
};

// JS getDay() returns 0=Sunday..6=Saturday — matches the array order.
const DAY_KEYS: readonly WorkPatternDayKey[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function isoDateInTz(momentUtc: Date, tz: string): { ymd: string; weekday: number } {
  const zoned = toZonedTime(momentUtc, tz);
  return {
    ymd: `${zoned.getFullYear()}-${pad2(zoned.getMonth() + 1)}-${pad2(zoned.getDate())}`,
    weekday: zoned.getDay(),
  };
}

/**
 * UTC start/end of each work window on the local calendar day that contains
 * `momentUtc` when viewed in `tz`. Useful for placing tasks inside a sale's
 * working hours regardless of physical machine TZ.
 *
 * Example : pattern `monday: [{start:"09:00", end:"12:00"}]`, tz `Europe/Paris`,
 * momentUtc a Monday → returns one entry from Mon 09:00 Paris (= 08:00 UTC
 * in winter, 07:00 UTC in summer) to Mon 12:00 Paris.
 */
export function getWorkPatternWindowsForDay(
  pattern: WorkPattern,
  momentUtc: Date,
  tz: string,
): { startUtc: Date; endUtc: Date }[] {
  const { ymd, weekday } = isoDateInTz(momentUtc, tz);
  const windows = pattern[DAY_KEYS[weekday]!] ?? [];
  return windows.map(({ start, end }) => ({
    startUtc: fromZonedTime(`${ymd}T${start}:00`, tz),
    endUtc: fromZonedTime(`${ymd}T${end}:00`, tz),
  }));
}

/** True if `pattern` has any window on the calendar day containing `momentUtc` in `tz`. */
export function isWorkingDay(pattern: WorkPattern, momentUtc: Date, tz: string): boolean {
  return getWorkPatternWindowsForDay(pattern, momentUtc, tz).length > 0;
}

/** Total minutes the pattern covers on that day. 0 for a day off. */
export function workingMinutesOnDay(pattern: WorkPattern, momentUtc: Date, tz: string): number {
  return getWorkPatternWindowsForDay(pattern, momentUtc, tz).reduce(
    (sum, w) => sum + (w.endUtc.getTime() - w.startUtc.getTime()) / 60_000,
    0,
  );
}

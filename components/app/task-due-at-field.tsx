"use client";

import { useState } from "react";

/**
 * Sprint 12.5 — paired field : deadline ("dueAt") + the "all day"
 * checkbox that hides the hour. Two inputs swap depending on the
 * toggle :
 *   - all-day on  → `<input type="date">` (the form posts YYYY-MM-DD ;
 *                   the server `new Date()`s it which lands at 00:00
 *                   UTC, fine for an all-day marker)
 *   - all-day off → `<input type="datetime-local">` (the existing
 *                   precise-deadline behavior)
 *
 * The `dueAtAllDay` checkbox posts "on" when checked / nothing when not,
 * so the server-side Zod schema handles both cases.
 *
 * Owns no business state — the parent passes the default values resolved
 * from the task row.
 */
export function TaskDueAtField({
  label,
  allDayLabel,
  defaultDueAt,
  defaultAllDay,
}: {
  label: string;
  allDayLabel: string;
  /** Pre-formatted value for the `<input>` (YYYY-MM-DD or YYYY-MM-DDTHH:mm).
   *  Empty string when the task has no dueAt. */
  defaultDueAt: string;
  defaultAllDay: boolean;
}) {
  const [allDay, setAllDay] = useState(defaultAllDay);

  // When the toggle flips we keep just the date part for "all day" and
  // append a midday time when going back to precise (so the picker
  // doesn't jump to 00:00 surprise). The DOM input keeps its own value
  // since we're not controlling it ; we feed the right default through
  // the `defaultValue` and the type switch.
  const datePart = defaultDueAt.slice(0, 10);
  const dateTimeDefault = defaultDueAt.length >= 16 ? defaultDueAt : datePart ? `${datePart}T09:00` : "";

  return (
    <div>
      <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
        {label}
      </label>
      <input
        // `key` resets the DOM input when the user flips the toggle, so the
        // browser native picker re-initialises with the right type + value.
        key={allDay ? "date" : "datetime"}
        type={allDay ? "date" : "datetime-local"}
        name="dueAt"
        defaultValue={allDay ? datePart : dateTimeDefault}
        className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
      />
      <label className="mt-1.5 inline-flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
        <input
          type="checkbox"
          name="dueAtAllDay"
          checked={allDay}
          onChange={(e) => setAllDay(e.target.checked)}
          className="h-3.5 w-3.5"
        />
        {allDayLabel}
      </label>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  DEFAULT_WORK_PATTERN,
  type WorkPattern,
  type WorkPatternDayKey,
  type TimeWindow,
} from "@/lib/sequences/work-pattern";

/**
 * Client editor for the per-day work pattern. Each day has up to two slots
 * (typical "morning" / "afternoon" pattern — covers the L&G dogfood case and
 * 99% of B2B SMB sales schedules). A toggle on the row turns the entire day
 * off ; turning it on restores the last edited windows (or the defaults).
 *
 * The state serializes to a JSON string in a hidden input named `workPattern`
 * so the surrounding server-action form picks it up via FormData.
 */

type RowState = {
  enabled: boolean;
  morning: { start: string; end: string };
  afternoon: { start: string; end: string };
  // Tracks whether the user explicitly cleared the afternoon slot (vs. just
  // having empty inputs by accident). Persisted shape : if false, we emit a
  // single window ; if true (default), both windows when filled.
  hasAfternoon: boolean;
};

const DAYS: readonly { key: WorkPatternDayKey; tKey: string }[] = [
  { key: "monday",    tKey: "mon" },
  { key: "tuesday",   tKey: "tue" },
  { key: "wednesday", tKey: "wed" },
  { key: "thursday",  tKey: "thu" },
  { key: "friday",    tKey: "fri" },
  { key: "saturday",  tKey: "sat" },
  { key: "sunday",    tKey: "sun" },
];

const FALLBACK_MORNING: TimeWindow = { start: "09:00", end: "12:00" };
const FALLBACK_AFTERNOON: TimeWindow = { start: "14:00", end: "17:00" };

function rowFromPattern(pattern: WorkPattern, day: WorkPatternDayKey): RowState {
  const windows = pattern[day];
  if (!windows || windows.length === 0) {
    return {
      enabled: false,
      morning: { ...FALLBACK_MORNING },
      afternoon: { ...FALLBACK_AFTERNOON },
      hasAfternoon: true,
    };
  }
  const [first, second] = windows;
  return {
    enabled: true,
    morning: first ? { ...first } : { ...FALLBACK_MORNING },
    afternoon: second ? { ...second } : { ...FALLBACK_AFTERNOON },
    hasAfternoon: Boolean(second),
  };
}

function patternFromRows(rows: Record<WorkPatternDayKey, RowState>): WorkPattern {
  const out: WorkPattern = {};
  for (const { key } of DAYS) {
    const row = rows[key];
    if (!row.enabled) continue;
    const windows: TimeWindow[] = [
      { start: row.morning.start as `${string}:${string}`, end: row.morning.end as `${string}:${string}` },
    ];
    if (row.hasAfternoon) {
      windows.push({
        start: row.afternoon.start as `${string}:${string}`,
        end: row.afternoon.end as `${string}:${string}`,
      });
    }
    out[key] = windows;
  }
  return out;
}

export function WorkPatternEditor({ defaultValue }: { defaultValue: WorkPattern | null }) {
  const t = useTranslations("pages.settings.profile.workPattern");

  const [rows, setRows] = useState<Record<WorkPatternDayKey, RowState>>(() => {
    const source = defaultValue ?? DEFAULT_WORK_PATTERN;
    return DAYS.reduce(
      (acc, { key }) => {
        acc[key] = rowFromPattern(source, key);
        return acc;
      },
      {} as Record<WorkPatternDayKey, RowState>,
    );
  });

  const serialized = useMemo(() => JSON.stringify(patternFromRows(rows)), [rows]);

  const update = (day: WorkPatternDayKey, patch: Partial<RowState>) =>
    setRows((prev) => ({ ...prev, [day]: { ...prev[day], ...patch } }));

  return (
    <div className="space-y-2">
      <Label>{t("title")}</Label>
      <input type="hidden" name="workPattern" value={serialized} />
      <p className="text-xs text-muted-foreground mb-2">{t("hint")}</p>

      <div className="space-y-1.5">
        {DAYS.map(({ key, tKey }) => {
          const row = rows[key];
          return (
            <div
              key={key}
              className="grid grid-cols-[110px_1fr] sm:grid-cols-[110px_1fr_auto_1fr] gap-2 items-center text-sm"
            >
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={row.enabled}
                  onChange={(e) => update(key, { enabled: e.target.checked })}
                  className="h-4 w-4"
                />
                <span className={row.enabled ? "" : "text-muted-foreground"}>{t(`day.${tKey}`)}</span>
              </label>

              {row.enabled ? (
                <>
                  <SlotInputs
                    value={row.morning}
                    onChange={(slot) => update(key, { morning: slot })}
                  />
                  {row.hasAfternoon ? (
                    <>
                      <span className="text-muted-foreground text-center hidden sm:inline">
                        +
                      </span>
                      <div className="flex items-center gap-1">
                        <SlotInputs
                          value={row.afternoon}
                          onChange={(slot) => update(key, { afternoon: slot })}
                        />
                        <button
                          type="button"
                          onClick={() => update(key, { hasAfternoon: false })}
                          className="text-xs text-muted-foreground hover:text-foreground px-1"
                          aria-label={t("removeSlot")}
                        >
                          ×
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="hidden sm:inline" />
                      <button
                        type="button"
                        onClick={() => update(key, { hasAfternoon: true })}
                        className="text-xs text-muted-foreground hover:text-foreground text-left"
                      >
                        + {t("addSlot")}
                      </button>
                    </>
                  )}
                </>
              ) : (
                <span className="text-xs text-muted-foreground italic sm:col-span-3">
                  {t("off")}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SlotInputs({
  value,
  onChange,
}: {
  value: { start: string; end: string };
  onChange: (slot: { start: string; end: string }) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Input
        type="time"
        value={value.start}
        onChange={(e) => onChange({ ...value, start: e.target.value })}
        className="h-8 w-[90px] px-2"
      />
      <span className="text-muted-foreground">–</span>
      <Input
        type="time"
        value={value.end}
        onChange={(e) => onChange({ ...value, end: e.target.value })}
        className="h-8 w-[90px] px-2"
      />
    </div>
  );
}

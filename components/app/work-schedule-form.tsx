"use client";

import { useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WorkPatternEditor } from "./work-pattern-editor";
import { updateWorkScheduleAction } from "@/lib/actions/profile";
import type { WorkPattern } from "@/lib/sequences/work-pattern";

/**
 * Client wrapper around the working-schedule form. Owns the submit lifecycle
 * so failures route through a soft `router.replace(?action_error=…)` instead
 * of the action's redirect, which would unmount this tree and discard the
 * user's in-progress work-pattern edits. The success path is silent : no
 * banner, just a `revalidatePath` from the action.
 */
export function WorkScheduleForm({
  defaults,
  tzChoices,
}: {
  defaults: {
    timezone: string;
    maxEmailsPerDay: number;
    maxCallsPerDay: number;
    workPattern: WorkPattern | null;
  };
  tzChoices: readonly string[];
}) {
  const t = useTranslations("pages.settings.profile");
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await updateWorkScheduleAction(fd);
      if (!result.ok) {
        // Soft URL update : the global <ActionErrorModal/> reads
        // `?action_error` and opens. router.replace keeps this client
        // component mounted, so the work-pattern state isn't reset.
        const next = new URLSearchParams(search.toString());
        next.set("action_error", result.code);
        router.replace(`${pathname}?${next.toString()}`);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="timezone">{t("timezone")}</Label>
        <select
          id="timezone"
          name="timezone"
          defaultValue={defaults.timezone}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          {tzChoices.map((tz) => (
            <option key={tz} value={tz}>{tz}</option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">{t("timezoneHint")}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="maxEmailsPerDay">{t("maxEmailsPerDay")}</Label>
          <Input
            id="maxEmailsPerDay"
            name="maxEmailsPerDay"
            type="number"
            min={0}
            max={1000}
            defaultValue={defaults.maxEmailsPerDay}
            required
          />
          <p className="text-xs text-muted-foreground">{t("maxEmailsPerDayHint")}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="maxCallsPerDay">{t("maxCallsPerDay")}</Label>
          <Input
            id="maxCallsPerDay"
            name="maxCallsPerDay"
            type="number"
            min={0}
            max={1000}
            defaultValue={defaults.maxCallsPerDay}
            required
          />
          <p className="text-xs text-muted-foreground">{t("maxCallsPerDayHint")}</p>
        </div>
      </div>

      <WorkPatternEditor defaultValue={defaults.workPattern} />

      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending}>
          {t("saveSchedule")}
        </Button>
      </div>
    </form>
  );
}

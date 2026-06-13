"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { backfillSiteGeocodesAction } from "@/lib/actions/sites";

/**
 * Surfaces a "Geocode N missing sites" button alongside the
 * `missingGeoHint` on /field. Runs the backfill server action then
 * router.refresh() so the new pins appear without a hard reload.
 *
 * Locked while the action is in flight ; the BAN portion is fast but
 * Nominatim rows serialize at 1 req/sec so a big foreign batch can
 * take a while. The button copy updates in flight to make that wait
 * visible.
 */
export function BackfillGeocodesButton({ pendingCount }: { pendingCount: number }) {
  const t = useTranslations("pages.field");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lastResult, setLastResult] = useState<{
    geocoded: number;
    failed: number;
  } | null>(null);

  function handleClick() {
    setLastResult(null);
    startTransition(async () => {
      try {
        const result = await backfillSiteGeocodesAction();
        if (result) {
          setLastResult({ geocoded: result.geocoded, failed: result.failed });
        } else {
          // wrapActionError returned undefined ; the wrapper already
          // redirected, but we want to record SOMETHING so the user
          // sees feedback if they navigate back.
          setLastResult({ geocoded: 0, failed: pendingCount });
        }
        router.refresh();
      } catch (err) {
        console.error("[BackfillGeocodesButton]", err);
        setLastResult({ geocoded: 0, failed: pendingCount });
      }
    });
  }

  return (
    <div className="inline-flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending || pendingCount === 0}
        onClick={handleClick}
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
        ) : (
          <Sparkles className="h-3.5 w-3.5 mr-1.5" />
        )}
        {pending
          ? t("backfill.inFlight", { count: pendingCount })
          : t("backfill.action", { count: pendingCount })}
      </Button>
      {lastResult && !pending && (
        <span className="text-xs text-muted-foreground">
          {t("backfill.result", {
            geocoded: lastResult.geocoded,
            failed: lastResult.failed,
          })}
        </span>
      )}
    </div>
  );
}

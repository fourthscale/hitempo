"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * Live countdown to a target moment. Ticks every second and renders
 * `Xj Yh Zm Ws` (locale-aware abbreviations from i18n). Past targets
 * render `t("countdown.elapsed")` and stop ticking. The interval is
 * cleared on unmount.
 *
 * The target is passed as an ISO string rather than a Date so React
 * skips re-mount diffs across SSR → CSR hand-off — the same string
 * round-trips identically.
 */
export function Countdown({ targetIso }: { targetIso: string }) {
  const t = useTranslations("pages.sequences.enrolment.countdown");
  // Init from current time so SSR renders the same starting value as the
  // first client paint (no hydration mismatch beyond the natural drift —
  // which the useEffect tick corrects on the next animation frame).
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const target = new Date(targetIso).getTime();
    // Stop ticking once we've passed the target — saves a wakeup every
    // second on stale enrolments.
    if (target <= Date.now()) {
      setNow(Date.now());
      return;
    }
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [targetIso]);

  const target = new Date(targetIso).getTime();
  const remainingMs = target - now;
  if (remainingMs <= 0) return <span>{t("elapsed")}</span>;

  const totalSec = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  // Drop leading zero-units so a 5-minute wait shows "5m 12s", not
  // "0j 0h 5m 12s". Always keep at least one segment (seconds for sub-min).
  const parts: string[] = [];
  if (days > 0) parts.push(t("days", { n: days }));
  if (days > 0 || hours > 0) parts.push(t("hours", { n: hours }));
  if (days > 0 || hours > 0 || minutes > 0) parts.push(t("minutes", { n: minutes }));
  parts.push(t("seconds", { n: seconds }));

  return <span className="tabular-nums">{parts.join(" ")}</span>;
}

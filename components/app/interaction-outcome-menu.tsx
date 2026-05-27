"use client";

import { useState, useTransition } from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { updateInteractionOutcomeAction } from "@/lib/actions/interactions";
import { cn } from "@/lib/utils";

export type InteractionOutcome =
  | "no_response"
  | "positive_reply"
  | "negative_reply"
  | "out_of_office"
  | "wrong_contact"
  | "rdv_scheduled"
  | "opted_out";

const OUTCOMES: InteractionOutcome[] = [
  "positive_reply",
  "rdv_scheduled",
  "no_response",
  "negative_reply",
  "out_of_office",
  "wrong_contact",
  "opted_out",
];

function outcomeClasses(outcome: InteractionOutcome | null): string {
  switch (outcome) {
    case "positive_reply":
    case "rdv_scheduled":
      return "bg-emerald-50 text-emerald-700 hover:bg-emerald-100";
    case "negative_reply":
    case "opted_out":
      return "bg-rose-50 text-rose-700 hover:bg-rose-100";
    case "no_response":
    case "out_of_office":
      return "bg-amber-50 text-amber-700 hover:bg-amber-100";
    case "wrong_contact":
      return "bg-slate-100 text-slate-700 hover:bg-slate-200";
    default:
      return "bg-secondary text-muted-foreground hover:bg-secondary/80";
  }
}

/**
 * Interactive replacement for the read-only outcome badge.
 *
 * Click the badge → dropdown of all 7 outcomes + "Clear outcome".
 * Selecting an item triggers `updateInteractionOutcomeAction` and the badge
 * updates optimistically (the parent re-fetches via revalidatePath, but we
 * also do a router.refresh implicitly via useTransition).
 *
 * Renders a "Set outcome" affordance when current outcome is null, so the
 * user can always assign one — including on legacy interactions logged
 * before the no_response default was introduced.
 */
export function InteractionOutcomeMenu({
  interactionId,
  current,
  labels,
}: {
  interactionId: string;
  current: InteractionOutcome | null;
  labels: {
    outcomes: Record<InteractionOutcome, string>;
    setOutcome: string;
    clearOutcome: string;
  };
}) {
  const [pending, startTransition] = useTransition();
  // Optimistic local state ; corrected by the server revalidate.
  const [optimistic, setOptimistic] = useState<InteractionOutcome | null>(current);

  function applyOutcome(next: InteractionOutcome | "") {
    if ((next === "" ? null : next) === optimistic) return;
    setOptimistic(next === "" ? null : next);
    startTransition(async () => {
      const fd = new FormData();
      fd.append("interactionId", interactionId);
      fd.append("outcome", next);
      try {
        await updateInteractionOutcomeAction(fd);
      } catch {
        // Roll back on failure.
        setOptimistic(current);
      }
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded font-medium transition-colors outline-none cursor-pointer",
          outcomeClasses(optimistic),
          pending && "opacity-60",
        )}
      >
        <span>{optimistic ? labels.outcomes[optimistic] : labels.setOutcome}</span>
        <ChevronDown className="h-3 w-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {OUTCOMES.map((o) => (
          <DropdownMenuItem
            key={o}
            className="gap-2 cursor-pointer text-xs"
            onClick={() => applyOutcome(o)}
          >
            <span
              className={cn(
                "inline-block h-2 w-2 rounded-full",
                outcomeClasses(o).split(" ")[0],
              )}
            />
            <span className="flex-1">{labels.outcomes[o]}</span>
            {optimistic === o && <Check className="h-3.5 w-3.5 text-brand-teal" />}
          </DropdownMenuItem>
        ))}
        {optimistic && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2 cursor-pointer text-xs text-muted-foreground"
              onClick={() => applyOutcome("")}
            >
              {labels.clearOutcome}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

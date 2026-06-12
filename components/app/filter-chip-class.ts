import { cn } from "@/lib/utils";

/**
 * Shared className for the filter-chip <select> pattern used on listing
 * pages (companies, contacts — and any future page that grows filters).
 *
 * One source of truth so chips stay visually consistent across pages :
 * same height, same active-state colour (brand-teal border + medium
 * weight), same inactive style. Keep this in sync with the placeholder
 * chip on /companies if we ever resurrect the disabled-button look.
 */
export function chipSelectClass(active: boolean): string {
  return cn(
    "inline-flex items-center gap-1.5 h-8 pl-3 pr-2 rounded-md border bg-background text-xs cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring",
    active
      ? "border-brand-teal text-foreground font-medium"
      : "border-border text-muted-foreground hover:text-foreground",
  );
}

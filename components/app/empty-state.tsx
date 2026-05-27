import Link from "next/link";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared empty-state component for "no data yet" surfaces across the app.
 *
 * Use inside a Card (or any container) to give the user a clear "nothing here"
 * signal plus an optional CTA. Centralized so all listings have the same
 * visual rhythm.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  /** Optional CTA. `{ label, href }` renders a link button ; `{ children }` lets the caller drop a custom element. */
  action?:
    | { label: string; href: string }
    | { children: ReactNode };
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center py-10 px-4 gap-3",
        className,
      )}
    >
      {Icon && (
        <div className="h-10 w-10 rounded-full bg-secondary text-muted-foreground/60 flex items-center justify-center">
          <Icon className="h-5 w-5" />
        </div>
      )}
      <div className="space-y-1 max-w-md">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && (
          <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
        )}
      </div>
      {action && "href" in action && (
        <Link
          href={action.href}
          className="text-xs font-medium text-brand-teal hover:underline mt-1"
        >
          {action.label} →
        </Link>
      )}
      {action && "children" in action && <div className="mt-1">{action.children}</div>}
    </div>
  );
}

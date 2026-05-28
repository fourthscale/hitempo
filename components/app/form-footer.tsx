import { cn } from "@/lib/utils";

/**
 * Action bar at the bottom of long forms.
 *
 * - On mobile/tablet portrait (< lg) : sticky to the viewport bottom so the
 *   submit + cancel buttons stay reachable while the user types into the
 *   form. Adds a top divider + background so the form content doesn't
 *   bleed through.
 * - On desktop (≥ lg) : sits in normal document flow at the end of the form.
 *
 * Drop in at the end of any form's body where the actions used to live.
 */
export function FormFooter({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // Sticky to the viewport bottom on mobile. The background +
        // top border keep the form content from bleeding through.
        // We don't bleed beyond the parent's padding — Cards keep
        // their visual containment.
        "sticky bottom-0 py-3 mt-4 z-10",
        "bg-background border-t border-border",
        "flex flex-wrap items-center justify-end gap-2",
        // Desktop : back into the document flow, no decoration.
        "lg:static lg:py-0 lg:mt-2 lg:bg-transparent lg:border-0 lg:z-auto",
        className,
      )}
    >
      {children}
    </div>
  );
}

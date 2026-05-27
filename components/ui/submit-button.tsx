"use client";

import { type ComponentProps, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Drop-in replacement for `<Button type="submit">` inside a `<form action={...}>`.
 *
 * Reads the form's pending state via `useFormStatus` (must be a descendant
 * of the form) and :
 *   - disables itself while the action is in flight
 *   - swaps the leading icon for a spinner
 *   - optionally swaps the label for a "pending" variant
 *
 * Outside a form, falls back to the static button so the component is safe
 * to use in any context.
 */
export function SubmitButton({
  children,
  pendingChildren,
  disabled,
  ...props
}: Omit<ComponentProps<typeof Button>, "type"> & {
  /** Override the label/content while the action is pending. Defaults to `children`. */
  pendingChildren?: ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <Button {...props} type="submit" disabled={disabled || pending}>
      {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" data-icon="inline-start" />}
      {pending ? (pendingChildren ?? children) : children}
    </Button>
  );
}

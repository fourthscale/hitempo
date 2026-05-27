"use client";

import type { ReactNode } from "react";

/**
 * Drop-in `<form>` replacement that confirms before submitting.
 * Same children API — the action prop is passed straight through to the
 * native form, so the server action behaves identically.
 */
export function ConfirmForm({
  message,
  children,
  ...props
}: React.FormHTMLAttributes<HTMLFormElement> & {
  message: string;
  children: ReactNode;
}) {
  return (
    <form
      {...props}
      onSubmit={(e) => {
        if (!window.confirm(message)) {
          e.preventDefault();
        }
      }}
    >
      {children}
    </form>
  );
}

"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Inline "Add site" affordance — button on the right of the section title,
 * form panel appears below when opened. Mirrors the pattern used by Contacts'
 * "+ New contact" button on the company detail page (which routes), with
 * the difference that sites are managed inline (no dedicated route).
 *
 * The form children are server-rendered above; this client wrapper only
 * controls open/close state.
 */
export function SitesAdd({
  title,
  addLabel,
  cancelLabel,
  children,
}: {
  title: string;
  addLabel: string;
  cancelLabel: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-serif text-2xl font-bold">{title}</h2>
        <Button
          type="button"
          size="sm"
          variant={open ? "ghost" : "outline"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? (
            cancelLabel
          ) : (
            <>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              {addLabel}
            </>
          )}
        </Button>
      </div>
      {open && (
        <Card className="p-6 mb-4">
          {children}
        </Card>
      )}
    </>
  );
}

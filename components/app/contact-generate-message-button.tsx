"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  GenerateMessageDialog,
  type GenerateMessageDialogProps,
} from "@/components/app/generate-message-dialog";

/**
 * Small client wrapper that places a "Generate message" button in the page
 * header and owns the open/close state of the dialog. All dialog props are
 * pre-computed by the parent server component.
 */
export function ContactGenerateMessageButton({
  label,
  ...dialogProps
}: Omit<GenerateMessageDialogProps, "open" | "onOpenChange" | "mode"> & {
  label: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5"
      >
        <Sparkles className="h-3.5 w-3.5" />
        {label}
      </Button>
      <GenerateMessageDialog
        {...dialogProps}
        mode="contact"
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

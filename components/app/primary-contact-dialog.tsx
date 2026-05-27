"use client";

import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type ContactOption = {
  id: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
};

/**
 * Dialog to pick the primary contact for a company.
 * - Trigger button (small "Modifier" or "Définir") on the card top right.
 * - Modal with a select + Save + Cancel.
 * - Closes on submit (revalidatePath in the action will refresh the card).
 */
export function PrimaryContactDialog({
  companyId,
  currentPrimaryId,
  contacts,
  action,
  triggerLabel,
  dialogTitle,
  dialogDescription,
  saveLabel,
  cancelLabel,
  noneLabel,
  selectLabel,
}: {
  companyId: string;
  currentPrimaryId: string | null;
  contacts: ContactOption[];
  action: (formData: FormData) => Promise<void> | void;
  triggerLabel: string;
  dialogTitle: string;
  dialogDescription: string;
  saveLabel: string;
  cancelLabel: string;
  noneLabel: string;
  selectLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      await action(formData);
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <Pencil className="h-3.5 w-3.5 mr-1.5" />
        {triggerLabel}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          {dialogDescription && (
            <p className="text-sm text-muted-foreground">{dialogDescription}</p>
          )}
        </DialogHeader>
        <form action={handleSubmit} className="space-y-4">
          <input type="hidden" name="companyId" value={companyId} />
          <div className="flex flex-col gap-1">
            <Label htmlFor="contactId">{selectLabel}</Label>
            <select
              id="contactId"
              name="contactId"
              defaultValue={currentPrimaryId ?? ""}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">{noneLabel}</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.firstName} {c.lastName}
                  {c.jobTitle ? ` — ${c.jobTitle}` : ""}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              {cancelLabel}
            </Button>
            <Button type="submit" disabled={isPending}>
              {saveLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

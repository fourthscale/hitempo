"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type Props = {
  companyId: string;
  companyName?: string;
  contactId?: string;
  action: (formData: FormData) => Promise<void>;
  labels: {
    logNew: string;
    fields: {
      type: string;
      channel: string;
      outcome: string;
      summary: string;
      occurredAt: string;
      interestLevel: string;
    };
    submit: string;
    cancel: string;
  };
  interactionTypes: { value: string; label: string }[];
  channels: { value: string; label: string }[];
  outcomes: { value: string; label: string }[];
};

export function LogInteractionForm({
  companyId,
  companyName,
  contactId,
  action,
  labels,
  interactionTypes,
  channels,
  outcomes,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const now = new Date();
  const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    try {
      await action(formData);
      setOpen(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-brand-teal hover:underline font-medium"
      >
        {labels.logNew}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogTitle>
            {labels.logNew}{companyName ? ` — ${companyName}` : ""}
          </DialogTitle>
          <DialogDescription className="sr-only">{labels.logNew}</DialogDescription>

          <form action={handleSubmit} className="space-y-4 mt-2">
            <input type="hidden" name="companyId" value={companyId} />
            {contactId && <input type="hidden" name="contactId" value={contactId} />}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1">
                  {labels.fields.type} *
                </label>
                <select
                  name="type"
                  required
                  className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
                >
                  {interactionTypes.map(({ value, label }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1">
                  {labels.fields.channel} *
                </label>
                <select
                  name="channel"
                  required
                  className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
                >
                  {channels.map(({ value, label }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1">
                  {labels.fields.outcome}
                </label>
                <select
                  name="outcome"
                  className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
                >
                  <option value="">—</option>
                  {outcomes.map(({ value, label }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1">
                  {labels.fields.occurredAt} *
                </label>
                <input
                  type="datetime-local"
                  name="occurredAt"
                  required
                  defaultValue={localIso}
                  className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1">
                {labels.fields.summary}
              </label>
              <textarea
                name="summary"
                rows={2}
                maxLength={2000}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm resize-y"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                {labels.cancel}
              </Button>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "…" : labels.submit}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

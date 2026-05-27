"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { logInteractionAction } from "@/lib/actions/interactions";

const INTERACTION_TYPES = [
  "first_contact", "follow_up", "call", "visit", "linkedin",
  "meeting", "demo", "proposal_sent", "note",
] as const;

const CHANNELS = ["email", "linkedin", "phone", "in_person", "video", "other"] as const;
const OUTCOMES = [
  "no_response", "positive_reply", "negative_reply", "out_of_office",
  "wrong_contact", "rdv_scheduled", "opted_out",
] as const;

export function TaskInteractionDialog({
  open,
  onOpenChange,
  taskId,
  companyId,
  companyName,
  contactId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  companyId: string;
  companyName: string;
  contactId?: string | null;
}) {
  const [pending, setPending] = useState(false);
  const router = useRouter();
  const tType = useTranslations("interactionType");
  const tChannel = useTranslations("interactionChannel");
  const tOutcome = useTranslations("interactionOutcome");
  const tI = useTranslations("pages.interactions");

  const now = new Date();
  const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    try {
      await logInteractionAction(formData);
      onOpenChange(false);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle>{tI("logNew")} — {companyName}</DialogTitle>
        <DialogDescription className="sr-only">{tI("logNew")}</DialogDescription>

        <form action={handleSubmit} className="space-y-4 mt-2">
          <input type="hidden" name="companyId" value={companyId} />
          <input type="hidden" name="taskId" value={taskId} />
          {contactId && <input type="hidden" name="contactId" value={contactId} />}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1">
                {tI("fields.type")} *
              </label>
              <select
                name="type"
                required
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
              >
                {INTERACTION_TYPES.map((v) => (
                  <option key={v} value={v}>{tType(v)}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1">
                {tI("fields.channel")} *
              </label>
              <select
                name="channel"
                required
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
              >
                {CHANNELS.map((v) => (
                  <option key={v} value={v}>{tChannel(v)}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1">
                {tI("fields.outcome")}
              </label>
              <select
                name="outcome"
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
              >
                <option value="">—</option>
                {OUTCOMES.map((v) => (
                  <option key={v} value={v}>{tOutcome(v)}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1">
                {tI("fields.occurredAt")} *
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
              {tI("fields.summary")}
            </label>
            <textarea
              name="summary"
              rows={2}
              maxLength={2000}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm resize-y"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={pending}>
              {tI("cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "…" : tI("submit")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

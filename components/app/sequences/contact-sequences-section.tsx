"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Zap, Pause, Play, Square } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { EmptyState } from "@/components/app/empty-state";
import { cn } from "@/lib/utils";
import {
  enrollContactAction,
  pauseEnrolmentAction,
  resumeEnrolmentAction,
  stopEnrolmentAction,
} from "@/lib/actions/sequences";

export type ContactEnrolmentRow = {
  id: string;
  sequenceId: string;
  sequenceName: string;
  status: string;
  currentStepOrder: number;
};

const selectCls =
  "h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

const ACTIVE = new Set(["active", "paused"]);

export function ContactSequencesSection({
  contactId,
  companyId,
  enrolments,
  availableSequences,
}: {
  contactId: string;
  companyId: string;
  enrolments: ContactEnrolmentRow[];
  availableSequences: { id: string; name: string }[];
}) {
  const t = useTranslations("pages.sequences");
  const [chosen, setChosen] = useState("");

  return (
    <section className="mb-8">
      <h2 className="font-serif text-lg font-bold mb-3">{t("contactSection.title")}</h2>

      {availableSequences.length > 0 && (
        <Card className="p-3 mb-3">
          <form
            action={async (fd) => {
              await enrollContactAction(fd);
            }}
            className="flex items-center gap-2"
          >
            <input type="hidden" name="contactId" value={contactId} />
            <input type="hidden" name="companyId" value={companyId} />
            <select
              name="sequenceId"
              required
              value={chosen}
              onChange={(e) => setChosen(e.target.value)}
              className={selectCls}
            >
              <option value="">{t("contactSection.enrollLabel")}</option>
              {availableSequences.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <SubmitButton disabled={!chosen}>
              <Zap className="mr-1.5 h-4 w-4" />
              {t("contactSection.enrollButton")}
            </SubmitButton>
          </form>
        </Card>
      )}

      {enrolments.length === 0 ? (
        <Card className="p-6">
          <EmptyState icon={Zap} title={t("contactSection.empty")} />
        </Card>
      ) : (
        <Card className="divide-y divide-border">
          {enrolments.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-3 p-3">
              <Link
                href={`/sequences/${e.sequenceId}/enrolments/${e.id}`}
                className="min-w-0 group"
              >
                <p className="text-sm font-medium text-foreground truncate group-hover:text-brand-teal transition-colors">
                  {e.sequenceName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("contactSection.step", { n: e.currentStepOrder + 1 })}
                </p>
              </Link>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "text-xs font-medium px-2 py-0.5 rounded-full border",
                    e.status === "active"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : e.status === "paused"
                        ? "bg-amber-50 text-amber-700 border-amber-200"
                        : "bg-secondary text-muted-foreground border-border",
                  )}
                >
                  {t(`enrolmentStatus.${e.status}`)}
                </span>
                {ACTIVE.has(e.status) && (
                  <div className="flex items-center gap-1">
                    {e.status === "active" ? (
                      <EnrolmentActionButton
                        action={pauseEnrolmentAction}
                        enrolmentId={e.id}
                        contactId={contactId}
                        label={t("contactSection.pause")}
                        icon={<Pause className="h-3.5 w-3.5" />}
                      />
                    ) : (
                      <EnrolmentActionButton
                        action={resumeEnrolmentAction}
                        enrolmentId={e.id}
                        contactId={contactId}
                        label={t("contactSection.resume")}
                        icon={<Play className="h-3.5 w-3.5" />}
                      />
                    )}
                    <EnrolmentActionButton
                      action={stopEnrolmentAction}
                      enrolmentId={e.id}
                      contactId={contactId}
                      label={t("contactSection.stop")}
                      icon={<Square className="h-3.5 w-3.5" />}
                    />
                  </div>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}
    </section>
  );
}

function EnrolmentActionButton({
  action,
  enrolmentId,
  contactId,
  label,
  icon,
}: {
  action: (formData: FormData) => Promise<void>;
  enrolmentId: string;
  contactId: string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="enrolmentId" value={enrolmentId} />
      <input type="hidden" name="contactId" value={contactId} />
      <Button type="submit" variant="ghost" size="sm" title={label} aria-label={label}>
        {icon}
      </Button>
    </form>
  );
}

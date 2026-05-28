"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { BrandBrief, BrandBriefLocale } from "@/lib/brand/brand-brief";
import { FormFooter } from "@/components/app/form-footer";

type Tab = "fr" | "en";

type FieldLabels = {
  positioning: string;
  positioningHint: string;
  toneOfVoice: string;
  toneOfVoiceHint: string;
  forbiddenWords: string;
  forbiddenWordsHint: string;
  signatureExpressions: string;
  signatureExpressionsHint: string;
  valueProps: string;
  valuePropsHint: string;
  proofPoints: string;
  proofPointsHint: string;
};

export type BrandBriefEditorLabels = {
  tabs: { fr: string; en: string };
  fields: FieldLabels;
  save: string;
  saved: string;
  listPlaceholder: string;
};

/**
 * Editor for the per-org brand brief. Two tabs (FR / EN), each tab contains
 * the same 6 fields. Both tabs share a single <form> — switching tabs is
 * purely a UI concern, all 12 fields are submitted together.
 *
 * List-type fields (toneOfVoice, etc.) are encoded as newline-separated
 * textareas. The server action splits and trims server-side.
 */
export function BrandBriefEditor({
  initial,
  action,
  labels,
}: {
  initial: BrandBrief;
  action: (formData: FormData) => Promise<void>;
  labels: BrandBriefEditorLabels;
}) {
  const [tab, setTab] = useState<Tab>("fr");
  const [savedFlash, setSavedFlash] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(formData: FormData) {
    startTransition(async () => {
      await action(formData);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2400);
    });
  }

  return (
    <form action={handleSubmit}>
      {/* Tab strip */}
      <div className="border-b border-border mb-6">
        <nav className="flex items-center gap-1">
          {(["fr", "en"] as const).map((key) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  "inline-flex items-center px-4 py-2.5 text-sm border-b-2 transition-colors",
                  active
                    ? "border-brand-teal text-foreground font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border cursor-pointer",
                )}
              >
                {labels.tabs[key]}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Both locales rendered ; only active tab is visible. Hidden tab's fields
          still belong to the form so we don't lose data when saving. */}
      <LocaleSection
        locale="fr"
        visible={tab === "fr"}
        initial={initial.fr}
        labels={labels}
      />
      <LocaleSection
        locale="en"
        visible={tab === "en"}
        initial={initial.en}
        labels={labels}
      />

      <FormFooter>
        {savedFlash && (
          <span className="text-sm text-emerald-600">{labels.saved}</span>
        )}
        <Button type="submit" disabled={isPending}>
          {labels.save}
        </Button>
      </FormFooter>
    </form>
  );
}

function LocaleSection({
  locale,
  visible,
  initial,
  labels,
}: {
  locale: Tab;
  visible: boolean;
  initial: BrandBriefLocale | undefined;
  labels: BrandBriefEditorLabels;
}) {
  return (
    <div className={cn(visible ? "block" : "hidden")}>
      <Card className="p-6 space-y-6">
        <Field
          name={`${locale}_positioning`}
          label={labels.fields.positioning}
          hint={labels.fields.positioningHint}
          rows={3}
          defaultValue={initial?.positioning ?? ""}
        />
        <Field
          name={`${locale}_toneOfVoice`}
          label={labels.fields.toneOfVoice}
          hint={labels.fields.toneOfVoiceHint}
          rows={4}
          defaultValue={(initial?.toneOfVoice ?? []).join("\n")}
          placeholder={labels.listPlaceholder}
        />
        <Field
          name={`${locale}_forbiddenWords`}
          label={labels.fields.forbiddenWords}
          hint={labels.fields.forbiddenWordsHint}
          rows={4}
          defaultValue={(initial?.forbiddenWords ?? []).join("\n")}
          placeholder={labels.listPlaceholder}
        />
        <Field
          name={`${locale}_signatureExpressions`}
          label={labels.fields.signatureExpressions}
          hint={labels.fields.signatureExpressionsHint}
          rows={4}
          defaultValue={(initial?.signatureExpressions ?? []).join("\n")}
          placeholder={labels.listPlaceholder}
        />
        <Field
          name={`${locale}_valueProps`}
          label={labels.fields.valueProps}
          hint={labels.fields.valuePropsHint}
          rows={5}
          defaultValue={(initial?.valueProps ?? []).join("\n")}
          placeholder={labels.listPlaceholder}
        />
        <Field
          name={`${locale}_proofPoints`}
          label={labels.fields.proofPoints}
          hint={labels.fields.proofPointsHint}
          rows={5}
          defaultValue={(initial?.proofPoints ?? []).join("\n")}
          placeholder={labels.listPlaceholder}
        />
      </Card>
    </div>
  );
}

function Field({
  name,
  label,
  hint,
  rows,
  defaultValue,
  placeholder,
}: {
  name: string;
  label: string;
  hint?: string;
  rows: number;
  defaultValue: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Textarea
        id={name}
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        placeholder={placeholder}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

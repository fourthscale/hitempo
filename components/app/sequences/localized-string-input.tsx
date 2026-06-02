"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { TemplateTextarea } from "@/components/app/messages/template-textarea";
import type { LocalizedString } from "@/lib/sequences/types";

type LocaleMap = { fr?: string; en?: string };

function toMap(value: LocalizedString | undefined | null): LocaleMap {
  if (value == null) return {};
  if (typeof value === "string") return { fr: value };
  return { fr: value.fr, en: value.en };
}

/**
 * Localized text input. Single field by default (the org's primary language),
 * "+ langue" reveals the second locale. Persists as `{ fr, en }` so a sequence
 * serves contacts of either language — locale is data, not a separate flow.
 *
 * Language-agnostic by design : labels reference FR/EN explicitly because the
 * editor author is choosing per-locale copy, not the UI language.
 */
export function LocalizedStringInput({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  templating,
}: {
  label: string;
  value: LocalizedString | undefined | null;
  onChange: (value: LocaleMap) => void;
  placeholder?: string;
  multiline?: boolean;
  /**
   * Sprint 12 — when true, swaps the Input/Textarea for `<TemplateTextarea>`
   * which adds the `{{variable}}` picker, highlight overlay, and preview.
   * Used on the `send_email` subject + body fields ; off by default so
   * other localized inputs (titleTemplate, descriptions) keep the plain
   * Input/Textarea behavior.
   */
  templating?: boolean;
}) {
  const map = toMap(value);
  const [showEn, setShowEn] = useState<boolean>(Boolean(map.en && map.en.length > 0));

  // Choose the field renderer once, based on the templating + multiline combo.
  const renderField = (lang: "fr" | "en") => {
    const current = lang === "fr" ? map.fr : map.en;
    const setLang = (next: string) => onChange({ ...map, [lang]: next });
    if (templating) {
      return (
        <TemplateTextarea
          value={current ?? ""}
          onChange={setLang}
          placeholder={placeholder}
          singleLine={!multiline}
          rows={multiline ? 6 : undefined}
        />
      );
    }
    const Field = multiline ? Textarea : Input;
    return (
      <Field
        value={current ?? ""}
        placeholder={placeholder}
        onChange={(e) => setLang(e.target.value)}
      />
    );
  };

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="space-y-2">
        <div>
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">FR</span>
          {renderField("fr")}
        </div>
        {showEn ? (
          <div>
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">EN</span>
            {renderField("en")}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowEn(true)}
            className="inline-flex items-center gap-1 text-xs text-brand-teal hover:underline"
          >
            <Plus className="h-3 w-3" /> EN
          </button>
        )}
      </div>
    </div>
  );
}

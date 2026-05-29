"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
}: {
  label: string;
  value: LocalizedString | undefined | null;
  onChange: (value: LocaleMap) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  const map = toMap(value);
  const [showEn, setShowEn] = useState<boolean>(Boolean(map.en && map.en.length > 0));

  const Field = multiline ? Textarea : Input;

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="space-y-2">
        <div>
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">FR</span>
          <Field
            value={map.fr ?? ""}
            placeholder={placeholder}
            onChange={(e) => onChange({ ...map, fr: e.target.value })}
          />
        </div>
        {showEn ? (
          <div>
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">EN</span>
            <Field
              value={map.en ?? ""}
              placeholder={placeholder}
              onChange={(e) => onChange({ ...map, en: e.target.value })}
            />
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

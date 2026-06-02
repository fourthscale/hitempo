"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Eye, Variable, X } from "lucide-react";
import {
  TEMPLATE_VARIABLES_BY_CATEGORY,
  type TemplateVariableCategory,
  type TemplateVariableDef,
} from "@/lib/messages/template-variables";
import {
  extractReferencedVariables,
  renderTemplate,
} from "@/lib/messages/template-render";
import { cn } from "@/lib/utils";

/**
 * Sprint 12 — input that lets the sale write a defined-message template
 * with `{{contact.firstName}}` / `{{contact.firstName || 'fallback'}}`
 * placeholders.
 *
 * Three composed parts :
 *   1. A textarea (or single-line input variant) carrying the raw template.
 *   2. A read-only highlight overlay aligned over the textarea : known
 *      variables get a teal pill, unknown ones a red pill. Pure CSS — the
 *      textarea text stays transparent so the overlay shows through. Both
 *      scroll together via a ref pair.
 *   3. A "Variable" picker popover : grouped by category, click inserts
 *      the `{{...}}` token at the caret. Falls back to end-of-text if the
 *      textarea has no focus.
 *
 * The "Preview" button next to the picker swaps the textarea for a
 * read-only rendered version using `TEMPLATE_VARIABLES[].sample` so the
 * sale sees the final wording without an enrolled contact in hand.
 *
 * Controlled component : `value` / `onChange` like a regular input. No
 * internal state of truth.
 */
export type TemplateTextareaProps = {
  value: string;
  onChange: (next: string) => void;
  /** Render as a single-line input (for the email subject) instead of a textarea. */
  singleLine?: boolean;
  placeholder?: string;
  rows?: number;
  name?: string;
  id?: string;
  className?: string;
  "aria-label"?: string;
};

export function TemplateTextarea(props: TemplateTextareaProps) {
  const { value, onChange, singleLine = false, placeholder, rows = 6, name, className } = props;
  const t = useTranslations("templateVariables");
  const tVar = useTranslations("templateVariables.labels");

  const autoId = useId();
  const id = props.id ?? autoId;

  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Track {known, unknown} referenced for the warning chip + counter.
  const refs = useMemo(() => extractReferencedVariables(value), [value]);
  const unknownCount = refs.unknown.length;
  const knownCount = refs.known.length;

  // --- caret insertion ----------------------------------------------------

  const insertAtCaret = useCallback(
    (token: string) => {
      const el = inputRef.current;
      if (!el) {
        onChange(value + token);
        return;
      }
      const start = el.selectionStart ?? value.length;
      const end = el.selectionEnd ?? value.length;
      const next = value.slice(0, start) + token + value.slice(end);
      onChange(next);
      // Move caret to right after the inserted token after the value updates.
      requestAnimationFrame(() => {
        if (!inputRef.current) return;
        inputRef.current.focus();
        const pos = start + token.length;
        inputRef.current.setSelectionRange(pos, pos);
      });
    },
    [onChange, value],
  );

  // --- overlay scroll sync ------------------------------------------------

  const syncScroll = useCallback(() => {
    if (!inputRef.current || !overlayRef.current) return;
    overlayRef.current.scrollTop = inputRef.current.scrollTop;
    overlayRef.current.scrollLeft = inputRef.current.scrollLeft;
  }, []);

  useLayoutEffect(() => {
    syncScroll();
  }, [value, syncScroll]);

  // --- preview ------------------------------------------------------------

  const sampleFacts = useMemo(() => {
    const acc: Record<string, string> = {};
    for (const cat of ["contact", "company", "sender"] as const) {
      for (const v of TEMPLATE_VARIABLES_BY_CATEGORY[cat]) {
        acc[v.key] = v.sample;
      }
    }
    return acc;
  }, []);
  const previewText = useMemo(
    () => renderTemplate(value, sampleFacts).text,
    [value, sampleFacts],
  );

  // --- render -------------------------------------------------------------

  // EVERY typography prop must match between the textarea and the
  // overlay or the pills drift away from the real text. Native textareas
  // inherit a system font + `line-height: normal` whose computed value
  // differs from what a `<div>` resolves to — so we lock both with
  // `font-sans` (Tailwind's stack) and explicit `leading-6`
  // (= 1.5rem = 24px, the natural line-height for `text-sm` / 14px).
  const sharedFieldClasses =
    "w-full rounded-md border border-input bg-background text-sm font-sans leading-6 focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground";
  const sharedPaddingClasses = "px-3 py-2";

  return (
    <div className={cn("space-y-2", className)}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <VariablePicker
          isOpen={pickerOpen}
          onOpenChange={setPickerOpen}
          onInsert={(def) => {
            insertAtCaret(`{{${def.key}}}`);
            setPickerOpen(false);
          }}
          labels={{
            triggerLabel: t("triggerLabel"),
            sectionLabels: {
              contact: t("category.contact"),
              company: t("category.company"),
              sender: t("category.sender"),
            },
            close: t("close"),
            tVar: (key) => tVar(key as Parameters<typeof tVar>[0]),
          }}
        />

        <button
          type="button"
          onClick={() => setPreviewOpen((s) => !s)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-secondary"
        >
          <Eye className="h-3.5 w-3.5" />
          {previewOpen ? t("hidePreview") : t("showPreview")}
        </button>

        {knownCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {t("knownCount", { n: knownCount })}
          </span>
        )}
        {unknownCount > 0 && (
          <span className="inline-flex items-center gap-1 text-xs text-rose-600">
            <AlertTriangle className="h-3 w-3" />
            {t("unknownCount", { n: unknownCount, names: refs.unknown.join(", ") })}
          </span>
        )}
      </div>

      {/* Field + overlay */}
      {previewOpen ? (
        <PreviewBox text={previewText} singleLine={singleLine} />
      ) : (
        <div className="relative">
          {/* Highlight overlay : positioned absolutely, sized like the
              textarea, renders the same text VISIBLY but with `{{...}}`
              wrapped in spans that carry a coloured background. The
              textarea itself has a transparent foreground (caret still
              visible) so what the user sees IS the overlay's text —
              and the pill backgrounds shine through. */}
          <div
            ref={overlayRef}
            aria-hidden="true"
            className={cn(
              sharedFieldClasses,
              sharedPaddingClasses,
              "pointer-events-none absolute inset-0 whitespace-pre-wrap text-foreground",
              singleLine ? "overflow-hidden" : "overflow-auto",
            )}
            style={{
              // Transparent border so the overlay stays the same size as
              // the textarea (which has `border border-input`, 1px) without
              // visually doubling it.
              border: "1px solid transparent",
              // CRITICAL : the textarea wraps long unbroken words with
              // `overflow-wrap: break-word` ; the overlay MUST use the same
              // algorithm or the caret will drift on long URLs / variables.
              overflowWrap: "break-word",
              // Add a trailing zero-width space so the overlay still
              // includes the implicit final line every browser allocates
              // for the caret at end-of-text. Without this, the caret
              // sits one line "below" the highlights on the last newline.
            }}
          >
            {/* Trailing "\n " keeps the overlay's last line height matched
                to the textarea's implicit caret line. */}
            {highlightSegments(value)}
            {value.endsWith("\n") && "​"}
          </div>

          {singleLine ? (
            <input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              id={id}
              name={name}
              type="text"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onScroll={syncScroll}
              placeholder={placeholder}
              className={cn(
                sharedFieldClasses,
                sharedPaddingClasses,
                "relative bg-transparent",
                "caret-foreground text-transparent selection:bg-brand-teal/30",
              )}
            />
          ) : (
            <textarea
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              id={id}
              name={name}
              rows={rows}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onScroll={syncScroll}
              placeholder={placeholder}
              className={cn(
                sharedFieldClasses,
                sharedPaddingClasses,
                "relative bg-transparent",
                "caret-foreground text-transparent selection:bg-brand-teal/30 resize-y",
              )}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Split the template into alternating text + placeholder spans and apply
 * the right pill style to each placeholder (teal for known, red for
 * unknown). Used by the overlay only — the textarea itself shows raw
 * text under a transparent foreground.
 */
function highlightSegments(template: string): React.ReactNode[] {
  if (!template) return [];
  // Same RE as the renderer but tolerant of malformed/partial tokens
  // (the sale is mid-typing — don't lose work).
  const re = /\{\{\s*([\w.]+)\s*(?:\|\|\s*['"][^'"]*['"]\s*)?\}\}/g;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(template)) !== null) {
    if (m.index > last) {
      out.push(<span key={`t${i++}`}>{template.slice(last, m.index)}</span>);
    }
    const path = m[1]!;
    const known = isKnown(path);
    out.push(
      <span
        key={`p${i++}`}
        className={cn(
          "rounded px-0.5",
          known
            ? "bg-brand-teal/15 text-brand-teal"
            : "bg-rose-100 text-rose-700 ring-1 ring-rose-300",
        )}
      >
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < template.length) {
    out.push(<span key={`t${i++}`}>{template.slice(last)}</span>);
  }
  return out;
}

function isKnown(path: string): boolean {
  // Inline tiny check to avoid pulling the typed guard into the client bundle.
  for (const cat of ["contact", "company", "sender"] as const) {
    for (const v of TEMPLATE_VARIABLES_BY_CATEGORY[cat]) {
      if (v.key === path) return true;
    }
  }
  return false;
}

function PreviewBox({ text, singleLine }: { text: string; singleLine: boolean }) {
  return (
    <div
      className={cn(
        "rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-sm whitespace-pre-wrap break-words",
        singleLine ? "" : "min-h-[6rem]",
      )}
    >
      {text || <span className="italic text-muted-foreground">…</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variable picker popover
// ---------------------------------------------------------------------------

type PickerLabels = {
  triggerLabel: string;
  sectionLabels: Record<TemplateVariableCategory, string>;
  close: string;
  tVar: (labelKey: string) => string;
};

function VariablePicker({
  isOpen,
  onOpenChange,
  onInsert,
  labels,
}: {
  isOpen: boolean;
  onOpenChange: (v: boolean) => void;
  onInsert: (def: TemplateVariableDef) => void;
  labels: PickerLabels;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Click outside closes the popover.
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onOpenChange(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [isOpen, onOpenChange]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => onOpenChange(!isOpen)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-secondary"
      >
        <Variable className="h-3.5 w-3.5" />
        {labels.triggerLabel}
      </button>
      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-md border border-border bg-popover shadow-md p-2 max-h-72 overflow-y-auto">
          <div className="flex items-center justify-between mb-1.5 px-1">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {labels.triggerLabel}
            </span>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label={labels.close}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {(["contact", "company", "sender"] as const).map((cat) => (
            <div key={cat} className="mb-2 last:mb-0">
              <div className="px-1 text-[10px] uppercase tracking-wider text-muted-foreground/80 mb-0.5">
                {labels.sectionLabels[cat]}
              </div>
              <ul className="space-y-0.5">
                {TEMPLATE_VARIABLES_BY_CATEGORY[cat].map((def) => (
                  <li key={def.key}>
                    <button
                      type="button"
                      onClick={() => onInsert(def)}
                      className="w-full text-left rounded px-2 py-1 text-xs hover:bg-secondary flex items-center justify-between gap-2"
                    >
                      <span>{labels.tVar(def.labelKey)}</span>
                      <code className="text-[10px] text-muted-foreground">
                        {`{{${def.key}}}`}
                      </code>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

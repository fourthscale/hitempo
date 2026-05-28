"use client";

import { useMemo, useReducer, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  Download,
  Upload,
  FileText,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  FileDown,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { runCsvImportAction } from "@/lib/actions/imports";
import type {
  CsvImportMode,
  CsvImportResult,
  CsvRowOutcome,
} from "@/lib/imports/csv-importer";

/**
 * Per-mode CSV import card.
 *
 * Three phases :
 *   1. **idle** — drop zone, "Download template" link, file input.
 *   2. **preview** — server-validated preview (dryRun=true) with per-row
 *      outcomes ; user reviews and either cancels or commits.
 *   3. **committed** — final result of the real import (dryRun=false).
 *
 * Errors surface via the global `<ActionErrorModal />` for system-level
 * issues (file too large, invalid mode) and via per-row outcomes for
 * validation issues that don't prevent the rest of the file from
 * processing.
 *
 * i18n is read directly via `useTranslations` (client-side) — the parent
 * server component cannot pass function-shaped formatters across the
 * server→client boundary.
 */

type Phase =
  | { kind: "idle" }
  | { kind: "previewing"; file: File }
  | { kind: "preview"; file: File; result: CsvImportResult }
  | { kind: "committing"; file: File }
  | { kind: "committed"; result: CsvImportResult };

type Action =
  | { type: "preview-start"; file: File }
  | { type: "preview-done"; result: CsvImportResult; file: File }
  | { type: "commit-start"; file: File }
  | { type: "commit-done"; result: CsvImportResult }
  | { type: "reset" };

function reducer(state: Phase, action: Action): Phase {
  switch (action.type) {
    case "preview-start":
      return { kind: "previewing", file: action.file };
    case "preview-done":
      return { kind: "preview", file: action.file, result: action.result };
    case "commit-start":
      return { kind: "committing", file: action.file };
    case "commit-done":
      return { kind: "committed", result: action.result };
    case "reset":
      return { kind: "idle" };
  }
}

export function CsvImportCard({
  mode,
  title,
  description,
}: {
  mode: CsvImportMode;
  title: string;
  description: string;
}) {
  const t = useTranslations("pages.import");
  const [phase, dispatch] = useReducer(reducer, { kind: "idle" });
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function onFilePicked(file: File) {
    dispatch({ type: "preview-start", file });
    startTransition(async () => {
      const fd = new FormData();
      fd.append("mode", mode);
      fd.append("dryRun", "true");
      fd.append("file", file);
      const result = await runCsvImportAction(fd);
      if (result) dispatch({ type: "preview-done", result, file });
    });
  }

  function onConfirm() {
    if (phase.kind !== "preview") return;
    const file = phase.file;
    dispatch({ type: "commit-start", file });
    startTransition(async () => {
      const fd = new FormData();
      fd.append("mode", mode);
      fd.append("dryRun", "false");
      fd.append("file", file);
      const result = await runCsvImportAction(fd);
      if (result) dispatch({ type: "commit-done", result });
    });
  }

  function reset() {
    dispatch({ type: "reset" });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <Card className="p-5">
      <div className="space-y-1 mb-4">
        <h2 className="font-medium text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      {phase.kind === "idle" && (
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/api/import/template?mode=${mode}`}
            download
            className="inline-flex"
          >
            <Button type="button" size="sm" variant="outline">
              <Download className="h-3.5 w-3.5 mr-1.5" />
              {t("downloadTemplate")}
            </Button>
          </a>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.tsv,text/csv"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFilePicked(f);
            }}
          />
          <Button
            type="button"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5 mr-1.5" />
            {t("pickFile")}
          </Button>
        </div>
      )}

      {(phase.kind === "previewing" || phase.kind === "committing") && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {phase.kind === "previewing" ? t("previewing") : t("committing")}
        </div>
      )}

      {phase.kind === "preview" && (
        <PreviewBlock
          result={phase.result}
          file={phase.file}
          isPending={isPending}
          onConfirm={onConfirm}
          onCancel={reset}
        />
      )}

      {phase.kind === "committed" && (
        <CommittedBlock result={phase.result} onReset={reset} />
      )}
    </Card>
  );
}

function PreviewBlock({
  result,
  file,
  isPending,
  onConfirm,
  onCancel,
}: {
  result: CsvImportResult;
  file: File;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("pages.import");
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <FileText className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">{file.name}</span>
        <span className="text-muted-foreground">
          ({Math.round(file.size / 1024)} kB)
        </span>
      </div>

      <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <div className="font-medium">{t("previewHeading")}</div>
        <div className="text-xs mt-0.5">
          {t("previewSummary", {
            total: result.totalRows,
            create: result.created,
            update: result.updated,
            errors: result.errors,
          })}
        </div>
      </div>

      <OutcomesReport result={result} />

      <div className="flex items-center gap-2 pt-1">
        <Button type="button" size="sm" onClick={onConfirm} disabled={isPending}>
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : null}
          {t("confirm")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onCancel}
          disabled={isPending}
        >
          {t("cancel")}
        </Button>
      </div>
    </div>
  );
}

function CommittedBlock({
  result,
  onReset,
}: {
  result: CsvImportResult;
  onReset: () => void;
}) {
  const t = useTranslations("pages.import");
  const allGood = result.errors === 0;
  return (
    <div className="space-y-3">
      <div
        className={
          allGood
            ? "rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
            : "rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        }
      >
        <div className="flex items-center gap-1.5 font-medium">
          {allGood ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <AlertTriangle className="h-4 w-4" />
          )}
          {t("committedHeading")}
        </div>
        <div className="text-xs mt-0.5">
          {t("committedSummary", {
            total: result.totalRows,
            created: result.created,
            updated: result.updated,
            errors: result.errors,
          })}
        </div>
      </div>

      <OutcomesReport result={result} />

      <div className="flex items-center gap-2 pt-1">
        <Button type="button" size="sm" variant="outline" onClick={onReset}>
          {t("importAnother")}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OutcomesReport — filter tabs + pagination + download
// ---------------------------------------------------------------------------

type FilterKind = "all" | "error" | "created" | "updated" | "skipped";

const PAGE_SIZE = 50;

function OutcomesReport({ result }: { result: CsvImportResult }) {
  const t = useTranslations("pages.import");
  const outcomes = result.outcomes;

  // Default to "error" tab when there are any errors — that's what the user
  // most likely wants to inspect.
  const initialFilter: FilterKind = result.errors > 0 ? "error" : "all";
  const [filter, setFilter] = useState<FilterKind>(initialFilter);
  const [visibleCount, setVisibleCount] = useState<number>(PAGE_SIZE);

  const filtered = useMemo(() => {
    if (filter === "all") return outcomes;
    return outcomes.filter((o) => o.status === filter);
  }, [outcomes, filter]);

  const visible = filtered.slice(0, visibleCount);
  const remaining = filtered.length - visible.length;

  if (outcomes.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center flex-wrap gap-2">
        <FilterTab
          active={filter === "all"}
          onClick={() => { setFilter("all"); setVisibleCount(PAGE_SIZE); }}
          label={t("filterAll")}
          count={outcomes.length}
        />
        {result.errors > 0 && (
          <FilterTab
            active={filter === "error"}
            onClick={() => { setFilter("error"); setVisibleCount(PAGE_SIZE); }}
            label={t("filterErrors")}
            count={result.errors}
            tone="error"
          />
        )}
        {result.created > 0 && (
          <FilterTab
            active={filter === "created"}
            onClick={() => { setFilter("created"); setVisibleCount(PAGE_SIZE); }}
            label={t("filterCreated")}
            count={result.created}
            tone="created"
          />
        )}
        {result.updated > 0 && (
          <FilterTab
            active={filter === "updated"}
            onClick={() => { setFilter("updated"); setVisibleCount(PAGE_SIZE); }}
            label={t("filterUpdated")}
            count={result.updated}
            tone="updated"
          />
        )}
        {result.skipped > 0 && (
          <FilterTab
            active={filter === "skipped"}
            onClick={() => { setFilter("skipped"); setVisibleCount(PAGE_SIZE); }}
            label={t("filterSkipped")}
            count={result.skipped}
          />
        )}

        <div className="flex-1" />

        {result.errors > 0 && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => downloadErrorReport(outcomes)}
          >
            <FileDown className="h-3.5 w-3.5 mr-1.5" />
            {t("downloadErrorReport")}
          </Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-md border border-border px-3 py-4 text-xs text-muted-foreground text-center">
          {t("noRowsForFilter")}
        </div>
      ) : (
        <>
          <OutcomesTable outcomes={visible} />

          {remaining > 0 && (
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground pt-1">
              <span>
                {t("paginationCounter", {
                  shown: visible.length,
                  total: filtered.length,
                })}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
                >
                  {t("showMore", { n: Math.min(PAGE_SIZE, remaining) })}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setVisibleCount(filtered.length)}
                >
                  {t("showAll")}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FilterTab({
  active,
  onClick,
  label,
  count,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  tone?: "error" | "created" | "updated";
}) {
  const toneClasses =
    tone === "error"
      ? "text-rose-700"
      : tone === "created"
      ? "text-emerald-700"
      : tone === "updated"
      ? "text-blue-700"
      : "text-foreground";
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs border transition-colors " +
        (active
          ? "border-foreground/30 bg-secondary"
          : "border-border bg-background hover:bg-secondary/50")
      }
    >
      <span className={toneClasses}>{label}</span>
      <span className="text-muted-foreground">{count}</span>
    </button>
  );
}

function OutcomesTable({ outcomes }: { outcomes: CsvRowOutcome[] }) {
  const t = useTranslations("pages.import");
  return (
    <div className="rounded-md border border-border overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-secondary/40 text-muted-foreground">
          <tr className="text-left">
            <th className="px-3 py-1.5 font-medium w-12">{t("line")}</th>
            <th className="px-3 py-1.5 font-medium w-24">{t("colStatus")}</th>
            <th className="px-3 py-1.5 font-medium">{t("colDetail")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {outcomes.map((o, idx) => (
            <tr
              key={idx}
              className={o.status === "error" ? "bg-rose-50/50" : undefined}
            >
              <td className="px-3 py-1.5 font-mono text-muted-foreground">
                {o.line}
              </td>
              <td className="px-3 py-1.5">
                {o.status === "created" && (
                  <span className="text-emerald-700">{t("statusCreated")}</span>
                )}
                {o.status === "updated" && (
                  <span className="text-blue-700">{t("statusUpdated")}</span>
                )}
                {o.status === "skipped" && (
                  <span className="text-muted-foreground">
                    {t("statusSkipped")}
                  </span>
                )}
                {o.status === "error" && (
                  <span className="text-rose-700">{t("statusError")}</span>
                )}
              </td>
              <td className="px-3 py-1.5 text-muted-foreground">
                {o.status === "error" && (
                  <>
                    {o.field ? (
                      <code className="text-foreground">{o.field}</code>
                    ) : null}
                    {o.field ? " — " : null}
                    {o.message}
                  </>
                )}
                {(o.status === "created" || o.status === "updated") && o.label && (
                  <span className="text-foreground">{o.label}</span>
                )}
                {o.status === "skipped" && (
                  <>
                    {o.label && (
                      <span className="text-foreground">{o.label} — </span>
                    )}
                    {o.reason}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Triggers a download of an "error-only" CSV report. Columns :
 * line, field, message. Trivial format the user can re-import after
 * fixing — keep it small and stable.
 */
function downloadErrorReport(outcomes: CsvRowOutcome[]) {
  const errors = outcomes.filter((o) => o.status === "error");
  const header = "line,field,message\r\n";
  const rows = errors
    .map((o) => {
      if (o.status !== "error") return "";
      return [String(o.line), csvCell(o.field ?? ""), csvCell(o.message)].join(",");
    })
    .filter(Boolean)
    .join("\r\n");
  const blob = new Blob([header + rows + "\r\n"], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `hitempo-import-errors-${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

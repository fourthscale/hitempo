"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckSquare, Square, ListChecks, Zap, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { resolveContactDisplayName } from "@/lib/contacts/contact-kind";
import { bulkEnrollContactsAction } from "@/lib/actions/sequences";
import { cn } from "@/lib/utils";

import { CONTACT_STATUSES } from "@/lib/contacts/contact-status";

export type ContactsBulkRow = {
  contact: {
    id: string;
    kind: "person" | "generic";
    firstName: string | null;
    lastName: string | null;
    jobTitle: string | null;
    role: string | null;
    email: string | null;
    relevance: number | null;
    status: string;
  };
  companyId: string;
  companyName: string;
};

/**
 * Filterable, selectable list of contacts. Owns three things :
 *   1. URL-state filter chips (company + status) — drive the server-rendered
 *      row set via search params, so the page itself stays a server component.
 *   2. Local selection set (in-memory only, resets on navigation).
 *   3. A "bulk action" dialog whose only current action is "enrol in a
 *      sequence". Adding more actions later = extend the dialog body, the
 *      selection plumbing stays the same.
 */
export function ContactsBulkBoard({
  rows,
  companies,
  sequences,
  selectedCompanyId,
  selectedStatus,
  flash,
}: {
  rows: ContactsBulkRow[];
  companies: { id: string; name: string }[];
  sequences: { id: string; name: string }[];
  selectedCompanyId: string | null;
  selectedStatus: string | null;
  flash: { enrolled: number; skipped: number } | null;
}) {
  const t = useTranslations("pages.contacts");
  const tRole = useTranslations("contactRole");
  const tStatus = useTranslations("contactStatus");
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [openSequenceDialog, setOpenSequenceDialog] = useState(false);

  const rowIds = useMemo(() => rows.map((r) => r.contact.id), [rows]);
  const allSelected = selected.size > 0 && selected.size === rowIds.length;
  const someSelected = selected.size > 0 && !allSelected;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectAll() {
    setSelected(new Set(rowIds));
  }
  function selectNone() {
    setSelected(new Set());
  }
  function invertSelection() {
    setSelected((prev) => {
      const next = new Set<string>();
      for (const id of rowIds) {
        if (!prev.has(id)) next.add(id);
      }
      return next;
    });
  }

  function updateFilter(key: "companyId" | "status", value: string) {
    const next = new URLSearchParams(search.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    // Filters change the row set, so the in-memory selection becomes stale.
    // Drop it on filter change rather than retain a confusing ghost selection.
    setSelected(new Set());
    next.delete("bulk_enrolled");
    next.delete("bulk_skipped");
    router.push(next.toString() ? `${pathname}?${next.toString()}` : pathname);
  }

  function clearFlash() {
    const next = new URLSearchParams(search.toString());
    next.delete("bulk_enrolled");
    next.delete("bulk_skipped");
    router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`);
  }

  const selectedArray = useMemo(() => Array.from(selected), [selected]);

  return (
    <>
      {flash && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900">
          <span>
            {t("bulk.flash", { enrolled: flash.enrolled, skipped: flash.skipped })}
          </span>
          <button type="button" onClick={clearFlash} className="text-emerald-700 hover:text-emerald-900">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Filters — chip-style selects matching the visual pattern used on the
          /companies page (label-as-placeholder, no separate label tag). Each
          change navigates immediately ; `value` (not `defaultValue`) so the
          chip mirrors the URL state after navigation. */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <select
          name="companyId"
          value={selectedCompanyId ?? ""}
          onChange={(e) => updateFilter("companyId", e.target.value)}
          aria-label={t("bulk.filterCompany")}
          className={chipSelectClass(selectedCompanyId != null)}
        >
          <option value="">{t("bulk.filterCompany")}</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select
          name="status"
          value={selectedStatus ?? ""}
          onChange={(e) => updateFilter("status", e.target.value)}
          aria-label={t("bulk.filterStatus")}
          className={chipSelectClass(selectedStatus != null)}
        >
          <option value="">{t("bulk.filterStatus")}</option>
          {CONTACT_STATUSES.map((s) => (
            <option key={s} value={s}>{tStatus(s)}</option>
          ))}
        </select>
      </div>

      {/* Selection toolbar — sticky to the top of the list so it stays in
          reach while the user scrolls a long contact list. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-secondary/30 px-3 py-2">
        <div className="flex items-center gap-2 text-sm">
          <ListChecks className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">
            {t("bulk.selectedCount", { count: selected.size })}
          </span>
          <span className="text-muted-foreground">
            {t("bulk.totalCount", { count: rowIds.length })}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={selectAll}>
            {t("bulk.selectAll")}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={invertSelection}>
            {t("bulk.invertSelection")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={selected.size === 0 || sequences.length === 0}
            onClick={() => setOpenSequenceDialog(true)}
          >
            <Zap className="mr-1.5 h-3.5 w-3.5" />
            {t("bulk.enrollInSequence")}
          </Button>
        </div>
      </div>

      {/* Rows */}
      <Card className="p-0 overflow-hidden">
        {/* Mobile / tablet portrait : cards with checkbox */}
        <ul className="lg:hidden divide-y divide-border">
          {rows.map(({ contact, companyName, companyId }) => {
            const checked = selected.has(contact.id);
            return (
              <li key={contact.id} className={cn("px-4 py-3 flex items-start gap-3", checked && "bg-brand-teal/5")}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(contact.id)}
                  className="mt-1 h-4 w-4 shrink-0"
                  aria-label={t("bulk.selectRow")}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3 mb-1.5">
                    <div className="min-w-0">
                      <Link href={`/contacts/${contact.id}`} className="font-medium text-foreground hover:text-brand-teal">
                        {resolveContactDisplayName(contact)}
                      </Link>
                      {contact.jobTitle && (
                        <div className="text-xs text-muted-foreground">{contact.jobTitle}</div>
                      )}
                      <Link href={`/companies/${companyId}`} className="block text-xs text-muted-foreground hover:text-brand-teal mt-0.5 truncate">
                        {companyName}
                      </Link>
                    </div>
                    {contact.relevance != null && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        {"★".repeat(contact.relevance)}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    {contact.role && (
                      <span className="px-1.5 py-0.5 rounded bg-secondary text-foreground">
                        {tRole(contact.role as Parameters<typeof tRole>[0])}
                      </span>
                    )}
                    <span className="px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                      {tStatus(contact.status as Parameters<typeof tStatus>[0])}
                    </span>
                    {contact.email && (
                      <span className="text-muted-foreground truncate">· {contact.email}</span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {/* Desktop : table with checkbox header */}
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-muted-foreground">
              <tr className="text-left">
                <th className="px-3 py-3 w-10">
                  <button
                    type="button"
                    onClick={allSelected ? selectNone : selectAll}
                    aria-label={allSelected ? t("bulk.selectNone") : t("bulk.selectAll")}
                    className="inline-flex items-center justify-center"
                  >
                    {allSelected ? (
                      <CheckSquare className="h-4 w-4 text-brand-teal" />
                    ) : someSelected ? (
                      <Square className="h-4 w-4 text-brand-teal fill-brand-teal/30" />
                    ) : (
                      <Square className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                </th>
                <th className="px-4 py-3 font-medium">{t("columns.name")}</th>
                <th className="px-4 py-3 font-medium">{t("columns.company")}</th>
                <th className="px-4 py-3 font-medium">{t("columns.role")}</th>
                <th className="px-4 py-3 font-medium">{t("columns.email")}</th>
                <th className="px-4 py-3 font-medium">{t("columns.relevance")}</th>
                <th className="px-4 py-3 font-medium">{t("columns.status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(({ contact, companyName, companyId }) => {
                const checked = selected.has(contact.id);
                return (
                  <tr key={contact.id} className={cn("hover:bg-secondary/30", checked && "bg-brand-teal/5")}>
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(contact.id)}
                        className="h-4 w-4"
                        aria-label={t("bulk.selectRow")}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/contacts/${contact.id}`} className="font-medium hover:text-brand-teal">
                        {resolveContactDisplayName(contact)}
                      </Link>
                      {contact.jobTitle && (
                        <div className="text-xs text-muted-foreground">{contact.jobTitle}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/companies/${companyId}`} className="text-muted-foreground hover:text-brand-teal">
                        {companyName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {contact.role
                        ? tRole(contact.role as Parameters<typeof tRole>[0])
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground break-all">{contact.email ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {contact.relevance ? "★".repeat(contact.relevance) : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {tStatus(contact.status as Parameters<typeof tStatus>[0])}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Sequence picker dialog — single bulk action for now. Other actions
          (assignee change, tag, etc.) will live in the same toolbar with
          their own dialogs ; the sequence dialog stays focused. */}
      {openSequenceDialog && (
        <SequencePickerDialog
          sequences={sequences}
          contactIds={selectedArray}
          onClose={() => setOpenSequenceDialog(false)}
        />
      )}
    </>
  );
}

function SequencePickerDialog({
  sequences,
  contactIds,
  onClose,
}: {
  sequences: { id: string; name: string }[];
  contactIds: string[];
  onClose: () => void;
}) {
  const t = useTranslations("pages.contacts.bulk");
  const [sequenceId, setSequenceId] = useState(sequences[0]?.id ?? "");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 px-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-serif text-lg font-bold mb-1">{t("dialogTitle")}</h3>
        <p className="text-sm text-muted-foreground mb-4">
          {t("dialogSubtitle", { count: contactIds.length })}
        </p>
        <form action={bulkEnrollContactsAction} className="space-y-3">
          <input type="hidden" name="contactIds" value={JSON.stringify(contactIds)} />
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="bulk-sequence">{t("sequenceLabel")}</label>
            <select
              id="bulk-sequence"
              name="sequenceId"
              required
              value={sequenceId}
              onChange={(e) => setSequenceId(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {sequences.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              {t("cancel")}
            </Button>
            <SubmitButton size="sm" disabled={!sequenceId || contactIds.length === 0}>
              <Zap className="mr-1.5 h-3.5 w-3.5" />
              {t("submit")}
            </SubmitButton>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Visual style matching the disabled placeholder chips on /companies — small
 * pill with a thin border. Bolder text + accent border when a value is
 * actually selected, so the user can spot active filters at a glance.
 */
function chipSelectClass(active: boolean): string {
  return cn(
    "inline-flex items-center gap-1.5 h-8 pl-3 pr-2 rounded-md border bg-background text-xs cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring",
    active
      ? "border-brand-teal text-foreground font-medium"
      : "border-border text-muted-foreground hover:text-foreground",
  );
}

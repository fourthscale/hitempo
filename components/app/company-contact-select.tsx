"use client";

import { useState } from "react";
import { resolveContactDisplayName, type ContactKind } from "@/lib/contacts/contact-kind";

type Company = { id: string; name: string };
type Contact = {
  id: string;
  kind?: ContactKind | null;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  email?: string | null;
};
type Site = { id: string; name: string; isPrimary?: boolean };

export function CompanyContactSelect({
  companies,
  defaultCompanyId,
  defaultContactId,
  defaultSiteId,
  initialContacts,
  initialSites,
  labelCompany,
  labelContact,
  labelSite,
  placeholderCompany,
  placeholderContact,
  placeholderSite,
  hintSelectCompany,
  withSite = false,
}: {
  companies: Company[];
  defaultCompanyId?: string;
  defaultContactId?: string;
  /** Sprint 12.5 — only meaningful when `withSite` is true. */
  defaultSiteId?: string;
  initialContacts?: Contact[];
  initialSites?: Site[];
  labelCompany: string;
  labelContact: string;
  labelSite?: string;
  placeholderCompany: string;
  placeholderContact: string;
  placeholderSite?: string;
  hintSelectCompany: string;
  /** When true, renders an extra Site select bound to the same company.
   *  Off by default so existing callers (no site) stay unaffected. */
  withSite?: boolean;
}) {
  const [companyId, setCompanyId] = useState(defaultCompanyId ?? "");
  const [contacts, setContacts] = useState<Contact[]>(initialContacts ?? []);
  const [sites, setSites] = useState<Site[]>(initialSites ?? []);
  const [loading, setLoading] = useState(false);

  async function handleCompanyChange(id: string) {
    setCompanyId(id);
    setContacts([]);
    setSites([]);
    if (!id) return;
    setLoading(true);
    try {
      // Fetch contacts + sites in parallel — both endpoints take the
      // same companyId. Keeps the perceived latency to one round-trip.
      const fetches: Promise<unknown>[] = [
        fetch(`/api/contacts?companyId=${encodeURIComponent(id)}`).then((r) => r.json()),
      ];
      if (withSite) {
        fetches.push(
          fetch(`/api/sites?companyId=${encodeURIComponent(id)}`).then((r) => r.json()),
        );
      }
      const [c, s] = await Promise.all(fetches);
      setContacts(c as Contact[]);
      if (withSite && s) setSites(s as Site[]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div>
        <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
          {labelCompany}
        </label>
        <select
          name="companyId"
          value={companyId}
          onChange={(e) => handleCompanyChange(e.target.value)}
          className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
        >
          <option value="">{placeholderCompany}</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
          {labelContact}
        </label>
        <select
          name="contactId"
          defaultValue={defaultContactId ?? ""}
          disabled={!companyId || loading}
          className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm disabled:opacity-50"
        >
          <option value="">{placeholderContact}</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {resolveContactDisplayName(c)}{c.jobTitle ? ` · ${c.jobTitle}` : ""}
            </option>
          ))}
        </select>
        {!companyId && (
          <p className="text-xs text-muted-foreground mt-1">{hintSelectCompany}</p>
        )}
      </div>

      {withSite && labelSite && placeholderSite && (
        <div>
          <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
            {labelSite}
          </label>
          <select
            name="siteId"
            defaultValue={defaultSiteId ?? ""}
            disabled={!companyId || loading}
            className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm disabled:opacity-50"
          >
            <option value="">{placeholderSite}</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}{s.isPrimary ? " ·★" : ""}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}

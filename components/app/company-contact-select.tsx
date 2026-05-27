"use client";

import { useState } from "react";

type Company = { id: string; name: string };
type Contact = { id: string; firstName: string; lastName: string; jobTitle: string | null };

export function CompanyContactSelect({
  companies,
  defaultCompanyId,
  defaultContactId,
  initialContacts,
  labelCompany,
  labelContact,
  placeholderCompany,
  placeholderContact,
  hintSelectCompany,
}: {
  companies: Company[];
  defaultCompanyId?: string;
  defaultContactId?: string;
  initialContacts?: Contact[];
  labelCompany: string;
  labelContact: string;
  placeholderCompany: string;
  placeholderContact: string;
  hintSelectCompany: string;
}) {
  const [companyId, setCompanyId] = useState(defaultCompanyId ?? "");
  const [contacts, setContacts] = useState<Contact[]>(initialContacts ?? []);
  const [loading, setLoading] = useState(false);

  async function handleCompanyChange(id: string) {
    setCompanyId(id);
    setContacts([]);
    if (!id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/contacts?companyId=${encodeURIComponent(id)}`);
      setContacts(await res.json());
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
              {c.firstName} {c.lastName}{c.jobTitle ? ` · ${c.jobTitle}` : ""}
            </option>
          ))}
        </select>
        {!companyId && (
          <p className="text-xs text-muted-foreground mt-1">{hintSelectCompany}</p>
        )}
      </div>
    </>
  );
}

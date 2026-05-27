"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";

/**
 * Client Component for the "Company + Site" combo in the contact form.
 * Sites are filtered to only those belonging to the selected company.
 * Switching companies resets the site selection.
 *
 * Kept as a Client Component because we want instant filtering without a
 * server round-trip when the user changes the company dropdown.
 */
export function CompanySiteSelects({
  companies,
  sites,
  labelCompany,
  labelSite,
  labelSiteNone,
  labelSiteUnavailable,
  defaultCompanyId = "",
  defaultSiteId = "",
}: {
  companies: { id: string; name: string }[];
  sites: { id: string; name: string; companyId: string }[];
  labelCompany: string;
  labelSite: string;
  labelSiteNone: string;
  labelSiteUnavailable: string;
  defaultCompanyId?: string;
  defaultSiteId?: string;
}) {
  const [companyId, setCompanyId] = useState(defaultCompanyId);
  const [siteId, setSiteId] = useState(defaultSiteId);

  const filteredSites = sites.filter((s) => s.companyId === companyId);
  // If the previously-selected site doesn't belong to the new company, drop it
  const effectiveSiteId = filteredSites.some((s) => s.id === siteId) ? siteId : "";

  return (
    <>
      <div className="flex flex-col gap-1">
        <Label htmlFor="companyId">{labelCompany} *</Label>
        <select
          id="companyId"
          name="companyId"
          required
          value={companyId}
          onChange={(e) => {
            setCompanyId(e.target.value);
            setSiteId(""); // reset site whenever the company changes
          }}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="" disabled>—</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="siteId">{labelSite}</Label>
        <select
          id="siteId"
          name="siteId"
          value={effectiveSiteId}
          onChange={(e) => setSiteId(e.target.value)}
          disabled={!companyId || filteredSites.length === 0}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {!companyId ? (
            <option value="">{labelSiteUnavailable}</option>
          ) : (
            <>
              <option value="">{labelSiteNone}</option>
              {filteredSites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </>
          )}
        </select>
      </div>
    </>
  );
}

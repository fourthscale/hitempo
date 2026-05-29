/**
 * Single source of truth for CSV column headers across all import modes.
 *
 * Used by :
 *   - the `/api/import/template?mode=<mode>` route to generate downloadable
 *     templates the user fills in
 *   - the strategies (validation, column mapping) — same header set, no
 *     drift possible
 *   - the column-mapping UI to auto-detect "standard" columns
 *
 * Each mode declares `headers` (the expected column names, in order) and
 * `example` (one bidon row demonstrating the format). The user deletes the
 * example row before re-uploading.
 *
 * Pure module : no I/O, no runtime config. Easy to import from anywhere.
 */

import type { CsvImportMode } from "./csv-importer";

type TemplateSpec = {
  /** Column headers in canonical order. */
  headers: readonly string[];
  /** One illustrative row — same length as headers, will be parsed back. */
  example: readonly string[];
};

const COMPANIES: TemplateSpec = {
  headers: [
    "organisation_ref",
    "name",
    "legal_name",
    "website_url",
    "linkedin_url",
    "relationship_type",
    "industry",
    "size_estimate",
    "standing",
    "primary_locale",
    "signal_type",
    "signal_source",
    "notes",
    "parent_organisation_ref",
  ],
  example: [
    "ACME-001",
    "Example Hotel",
    "Example Hotel SAS",
    "https://example-hotel.com",
    "https://www.linkedin.com/company/example-hotel",
    "prospect",
    "hospitality",
    "50-200",
    "4",
    "fr",
    "renovation",
    "press release",
    "Spotted in Le Figaro — renovation announced for Q3.",
    "",
  ],
};

const CONTACTS: TemplateSpec = {
  headers: [
    "organisation_ref",
    "company_organisation_ref",
    "site_organisation_ref",
    "kind",
    "first_name",
    "last_name",
    "job_title",
    "role",
    "email",
    "phone",
    "linkedin_url",
    "preferred_language",
    "preferred_channel",
    "relevance",
    "status",
    "is_primary_for_company",
    "is_primary_for_site",
    "notes",
  ],
  example: [
    "CONTACT-001",
    "ACME-001",
    "SITE-001",
    "person",
    "Jane",
    "Example",
    "General Manager",
    "decision_maker",
    "jane.example@example-hotel.com",
    "+33 1 23 45 67 89",
    "https://www.linkedin.com/in/jane-example",
    "fr",
    "email",
    "5",
    "to_contact",
    "true",
    "true",
    "Met at MIPIM 2025.",
  ],
};

const SITES: TemplateSpec = {
  headers: [
    "organisation_ref",
    "company_organisation_ref",
    "name",
    "type",
    "address_line_1",
    "postal_code",
    "city",
    "region",
    "country",
    "is_primary",
    "standing",
    "notes",
  ],
  example: [
    "SITE-001",
    "ACME-001",
    "Example Hotel — Champs-Élysées",
    "hotel",
    "12 Avenue des Champs-Élysées",
    "75008",
    "Paris",
    "Île-de-France",
    "FR",
    "true",
    "4",
    "Flagship location.",
  ],
};

const ALL_IN_ONE: TemplateSpec = {
  // The mega-row : every importable column for a (company, optional site,
  // optional contact) tuple. Users delete the columns they don't use.
  headers: [
    // Company
    "company_organisation_ref",
    "company_name",
    "company_legal_name",
    "company_website",
    "company_linkedin_url",
    "company_industry",
    "company_size_estimate",
    "company_standing",
    "company_relationship_type",
    "company_primary_locale",
    "company_signal_type",
    "company_signal_source",
    "company_notes",
    "company_parent_organisation_ref",
    // Site (optional — leave blank to skip site creation)
    "site_organisation_ref",
    "site_name",
    "site_type",
    "site_address_line_1",
    "site_postal_code",
    "site_city",
    "site_region",
    "site_country",
    "site_is_primary",
    "site_standing",
    "site_notes",
    // Contact (optional — leave blank to skip contact creation)
    "contact_organisation_ref",
    "contact_kind",
    "contact_first_name",
    "contact_last_name",
    "contact_job_title",
    "contact_role",
    "contact_email",
    "contact_phone",
    "contact_linkedin_url",
    "contact_preferred_language",
    "contact_preferred_channel",
    "contact_relevance",
    "contact_is_primary_for_company",
    "contact_is_primary_for_site",
    "contact_notes",
  ],
  example: [
    // Company
    "ACME-001",
    "Example Hotel",
    "Example Hotel SAS",
    "https://example-hotel.com",
    "https://www.linkedin.com/company/example-hotel",
    "hospitality",
    "50-200",
    "4",
    "prospect",
    "fr",
    "renovation",
    "press release",
    "Spotted in Le Figaro — renovation announced for Q3.",
    "",
    // Site
    "SITE-001",
    "Example Hotel — Champs-Élysées",
    "hotel",
    "12 Avenue des Champs-Élysées",
    "75008",
    "Paris",
    "Île-de-France",
    "FR",
    "true",
    "4",
    "Flagship location.",
    // Contact
    "CONTACT-001",
    "person",
    "Jane",
    "Example",
    "General Manager",
    "decision_maker",
    "jane.example@example-hotel.com",
    "+33 1 23 45 67 89",
    "https://www.linkedin.com/in/jane-example",
    "fr",
    "email",
    "5",
    "true",
    "true",
    "Met at MIPIM 2025.",
  ],
};

const TEMPLATES: Record<CsvImportMode, TemplateSpec> = {
  companies: COMPANIES,
  contacts: CONTACTS,
  sites: SITES,
  "all-in-one": ALL_IN_ONE,
};

/** Public lookup — returns headers + example row for a given mode. */
export function getCsvTemplate(mode: CsvImportMode): TemplateSpec {
  return TEMPLATES[mode];
}

/** Just the headers, in canonical order. Convenience for validators. */
export function getCsvHeaders(mode: CsvImportMode): readonly string[] {
  return TEMPLATES[mode].headers;
}

/**
 * Renders a downloadable CSV string for the given mode :
 * header row + the single example row. Pure function, no I/O.
 *
 * CSV quoting follows RFC 4180 : fields are wrapped in `"` when they contain
 * a comma, quote, or newline ; embedded quotes are doubled.
 */
export function renderCsvTemplate(mode: CsvImportMode): string {
  const { headers, example } = TEMPLATES[mode];
  return [headers, example].map(serializeRow).join("\r\n") + "\r\n";
}

function serializeRow(values: readonly string[]): string {
  return values.map(escapeCell).join(",");
}

function escapeCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

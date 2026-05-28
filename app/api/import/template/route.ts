import { NextRequest, NextResponse } from "next/server";

import { getActiveOrg } from "@/lib/auth/context";
import {
  CSV_IMPORT_MODES,
  type CsvImportMode,
} from "@/lib/imports/csv-importer";
import { renderCsvTemplate } from "@/lib/imports/csv-template-headers";

/**
 * GET /api/import/template?mode=<mode>
 *
 * Returns a downloadable CSV template (header + one example row) for the
 * requested import mode. Drives the "Download template" buttons in
 * `/settings/import` so users always have a valid starting point.
 *
 * Auth-gated through `getActiveOrg` — only signed-in users with an active
 * org can download templates (no information leak to anonymous traffic).
 * The template content itself is static per mode, no tenant data leaves.
 */
export async function GET(req: NextRequest) {
  // Gate. If the user has no active org `getActiveOrg` redirects ;
  // we still call it for the side-effect of enforcing auth.
  await getActiveOrg();

  const mode = req.nextUrl.searchParams.get("mode");
  if (!mode || !isValidMode(mode)) {
    return NextResponse.json(
      { error: "invalid_mode", supported: CSV_IMPORT_MODES },
      { status: 400 },
    );
  }

  const csv = renderCsvTemplate(mode);
  const filename = `hitempo-import-${mode}-template.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}

function isValidMode(value: string): value is CsvImportMode {
  return (CSV_IMPORT_MODES as readonly string[]).includes(value);
}

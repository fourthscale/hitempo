"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getActiveOrg } from "@/lib/auth/context";
import {
  CSV_IMPORT_MODES,
  type CsvImportMode,
  type CsvImportResult,
} from "@/lib/imports/csv-importer";
import {
  CsvImportFileTooLargeError,
  CsvImportInvalidFileError,
} from "@/lib/imports/csv-import-errors";
import { CsvImportServiceFactory } from "@/lib/imports/csv-import-service-factory";
import { InvalidInputError } from "./user-facing-action-error";
import { withActionError } from "./wrap-action-error";

/**
 * `runCsvImportAction` — single server action driving the whole CSV
 * import flow for any mode.
 *
 * FormData expected :
 *   - `file`    : the uploaded CSV file (`File` object)
 *   - `mode`    : one of `CSV_IMPORT_MODES`
 *   - `dryRun`  : "true" for preview (no DB writes), "false" for commit
 *
 * Returns `CsvImportResult`. User-facing errors flow through the typed
 * hierarchy and surface as the global modal (`UserFacingActionError`).
 *
 * Side effects (only when `dryRun=false`) :
 *   - revalidates `/companies` / `/contacts` / `/tasks` depending on mode
 *   - no scoring recompute here — the strategy schedules it per-row if
 *     warranted (companies → revalidate triggers a re-fetch with stale
 *     scores ; the user can hit "recompute" if needed).
 */

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

const inputSchema = z.object({
  mode: z.enum(CSV_IMPORT_MODES),
  dryRun: z.preprocess(
    (v) => v === "true" || v === true,
    z.boolean(),
  ),
});

async function _runCsvImportAction(formData: FormData): Promise<CsvImportResult> {
  const parsed = inputSchema.safeParse({
    mode: formData.get("mode"),
    dryRun: formData.get("dryRun"),
  });
  if (!parsed.success) throw new InvalidInputError(parsed.error);

  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new CsvImportInvalidFileError("no file provided");
  }
  if (file.size === 0) {
    throw new CsvImportInvalidFileError("file is empty");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new CsvImportFileTooLargeError(file.size, MAX_FILE_BYTES);
  }

  const csv = await file.text();
  const { activeOrganization, user } = await getActiveOrg();

  const service = CsvImportServiceFactory.getInstance();
  const result = await service.run({
    mode: parsed.data.mode as CsvImportMode,
    csv,
    context: {
      organizationId: activeOrganization.id,
      userId: user.id,
    },
    dryRun: parsed.data.dryRun,
  });

  if (!parsed.data.dryRun) {
    // Refresh the surfaces that show imported entities. Sites bubble up
    // on company detail pages — `/companies` covers both list + detail
    // (Next.js revalidates the segment).
    if (
      parsed.data.mode === "companies" ||
      parsed.data.mode === "sites" ||
      parsed.data.mode === "all-in-one"
    ) {
      revalidatePath("/companies");
    }
    if (parsed.data.mode === "contacts" || parsed.data.mode === "all-in-one") {
      revalidatePath("/contacts");
    }
  }

  return result;
}

export const runCsvImportAction = withActionError(_runCsvImportAction);

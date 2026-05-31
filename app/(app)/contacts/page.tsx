import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus, Upload, User } from "lucide-react";
import { getActiveOrg } from "@/lib/auth/context";
import {
  listContactsByOrg,
  listCompaniesWithContactsForOrg,
} from "@/db/queries/contacts";
import { getActiveSequencesForTargeting } from "@/db/queries/sequences";
import { getDb } from "@/db/client";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ContactsBulkBoard } from "@/components/app/contacts/contacts-bulk-board";

const VALID_STATUSES = new Set([
  "to_contact",
  "to_follow_up",
  "qualified",
  "not_interested",
]);

function clampStatus(raw: string | undefined): string | null {
  return raw && VALID_STATUSES.has(raw) ? raw : null;
}

function clampUuid(raw: string | undefined): string | null {
  if (!raw) return null;
  // Loose UUID check — DB validates strictly. Goal here is just to drop
  // obvious garbage URL params before the query.
  return /^[0-9a-f-]{36}$/i.test(raw) ? raw : null;
}

function clampInt(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{
    companyId?: string;
    status?: string;
    bulk_enrolled?: string;
    bulk_skipped?: string;
  }>;
}) {
  const params = await searchParams;
  const selectedCompanyId = clampUuid(params.companyId);
  const selectedStatus = clampStatus(params.status);
  const flashEnrolled = clampInt(params.bulk_enrolled);
  const flashSkipped = clampInt(params.bulk_skipped);

  const { activeOrganization } = await getActiveOrg();
  const orgId = activeOrganization.id;

  const [rows, companies, sequences] = await Promise.all([
    listContactsByOrg(orgId, {
      companyId: selectedCompanyId ?? undefined,
      status: selectedStatus ?? undefined,
    }),
    listCompaniesWithContactsForOrg(orgId),
    getActiveSequencesForTargeting(getDb(), orgId),
  ]);

  const t = await getTranslations("pages.contacts");
  const tNav = await getTranslations("nav");

  const hasFilter = selectedCompanyId != null || selectedStatus != null;
  const flash =
    flashEnrolled != null || flashSkipped != null
      ? { enrolled: flashEnrolled ?? 0, skipped: flashSkipped ?? 0 }
      : null;

  return (
    <div className="max-w-[1400px] mx-auto">
      <PageHeader
        title={tNav("contacts")}
        subtitle={t("count", { count: rows.length })}
        right={
          <div className="flex items-center gap-2">
            <Link href="/settings/import">
              <Button variant="outline">
                <Upload className="h-4 w-4 mr-1.5" />
                {t("importCsv")}
              </Button>
            </Link>
            <Link href="/contacts/new">
              <Button>
                <Plus className="h-4 w-4 mr-1.5" />
                {t("new")}
              </Button>
            </Link>
          </div>
        }
      />

      {rows.length === 0 && !hasFilter ? (
        <Card className="p-0 overflow-hidden">
          <EmptyState
            icon={User}
            title={t("empty")}
            action={{ label: t("emptyAction"), href: "/contacts/new" }}
          />
        </Card>
      ) : (
        <ContactsBulkBoard
          rows={rows.map(({ contact, companyName, companyId }) => ({
            contact: {
              id: contact.id,
              kind: contact.kind,
              firstName: contact.firstName,
              lastName: contact.lastName,
              jobTitle: contact.jobTitle,
              role: contact.role,
              email: contact.email,
              relevance: contact.relevance,
              status: contact.status,
            },
            companyId,
            companyName,
          }))}
          companies={companies}
          sequences={sequences.map((s) => ({ id: s.id, name: s.name }))}
          selectedCompanyId={selectedCompanyId}
          selectedStatus={selectedStatus}
          flash={flash}
        />
      )}
    </div>
  );
}

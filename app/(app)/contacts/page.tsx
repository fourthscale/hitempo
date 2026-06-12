import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus, Upload, User } from "lucide-react";
import { getActiveOrg } from "@/lib/auth/context";
import {
  listContactsByOrg,
  listCompaniesWithContactsForOrg,
  UNASSIGNED_OWNER,
} from "@/db/queries/contacts";
import { getActiveSequencesForTargeting } from "@/db/queries/sequences";
import { getOrgMembersWithNames } from "@/db/queries/members";
import { getDb } from "@/db/client";
import { CONTACT_STATUSES } from "@/lib/contacts/contact-status";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ContactsBulkBoard } from "@/components/app/contacts/contacts-bulk-board";

const VALID_STATUSES = new Set<string>(CONTACT_STATUSES);

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
    owner?: string;
    bulk_enrolled?: string;
    bulk_skipped?: string;
  }>;
}) {
  const params = await searchParams;
  const selectedCompanyId = clampUuid(params.companyId);
  const selectedStatus = clampStatus(params.status);
  const flashEnrolled = clampInt(params.bulk_enrolled);
  const flashSkipped = clampInt(params.bulk_skipped);

  const { activeOrganization, user } = await getActiveOrg();
  const orgId = activeOrganization.id;

  // Members list is needed both for the dropdown AND to decide what
  // "default" means : only members get "default = me", platform admins
  // browsing an org they don't belong to fall back to "all" (otherwise
  // the page lands on an empty list with no obvious way out).
  const members = await getOrgMembersWithNames(orgId);
  const isMember = members.some((m) => m.userId === user.id);

  // Owner filter resolution :
  //   - no `owner` param        → default to the logged-in user when
  //                               they are an org member ; "all" when
  //                               they are not (platform admin)
  //   - `owner=all`             → no filter, show everyone's contacts
  //   - `owner=unassigned`      → contacts with no effective owner
  //   - `owner=<uuid>`          → that specific member
  const rawOwner = params.owner;
  const defaultOwnerId = isMember ? user.id : null;
  const selectedOwnerId: string | null =
    rawOwner === "all"
      ? null
      : rawOwner === UNASSIGNED_OWNER
        ? UNASSIGNED_OWNER
        : (clampUuid(rawOwner) ?? defaultOwnerId);

  const [rows, companies, sequences] = await Promise.all([
    listContactsByOrg(orgId, {
      companyId: selectedCompanyId ?? undefined,
      status: selectedStatus ?? undefined,
      ownerId: selectedOwnerId ?? undefined,
    }),
    listCompaniesWithContactsForOrg(orgId),
    getActiveSequencesForTargeting(getDb(), orgId),
  ]);

  const t = await getTranslations("pages.contacts");
  const tNav = await getTranslations("nav");

  // Owner default = current user, so a non-null `selectedOwnerId` here
  // is the norm, not an explicit user-set filter. Treat it as "filter
  // active" for the EmptyState gating below : if the user has 0 contacts
  // owned, the board must still render so they can switch to "Tous" /
  // pick someone else / inspect Non attribué. EmptyState is reserved for
  // the case where the org genuinely has 0 contacts (selectedOwnerId
  // === null = explicit "Tous", no other filter, 0 rows).
  const hasFilter =
    selectedCompanyId != null ||
    selectedStatus != null ||
    selectedOwnerId != null;
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
          rows={rows.map(({ contact, companyName, companyId, effectiveOwnerId }) => ({
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
            effectiveOwnerId,
            // Owner inherited from the company (not set on the contact
            // itself) — drives the "(inherited)" hint in the UI.
            ownerInherited: contact.ownerId == null && effectiveOwnerId != null,
          }))}
          companies={companies}
          sequences={sequences.map((s) => ({ id: s.id, name: s.name }))}
          members={members.map((m) => ({ userId: m.userId, displayName: m.displayName }))}
          currentUserId={user.id}
          selectedCompanyId={selectedCompanyId}
          selectedStatus={selectedStatus}
          selectedOwnerId={selectedOwnerId}
          flash={flash}
        />
      )}
    </div>
  );
}

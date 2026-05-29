import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Pencil, Circle } from "lucide-react";
import { getActiveOrg } from "@/lib/auth/context";
import { getDb } from "@/db/client";
import { getSequenceWithSteps } from "@/db/queries/sequences";
import { listEnrolmentsForSequence } from "@/db/queries/sequence-enrolments";
import { resolveContactDisplayName } from "@/lib/contacts/contact-kind";
import { publishedStepsToDraft } from "@/lib/sequences/draft-from-steps";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { SequenceFlowView } from "@/components/app/sequences/sequence-flow-view";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default async function SequenceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { activeOrganization } = await getActiveOrg();
  const data = await getSequenceWithSteps(getDb(), activeOrganization.id, id);
  if (!data) notFound();

  const enrolments = await listEnrolmentsForSequence(getDb(), activeOrganization.id, id);
  const t = await getTranslations("pages.sequences");

  const orgLocale = activeOrganization.defaultLocale;
  const triggerSummary = [
    ...data.sequence.targetRelationshipTypes,
    ...data.sequence.targetSiteTypes,
    ...data.sequence.targetContactRoles,
  ].join(" · ");

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title={data.sequence.name}
        subtitle={data.sequence.description ?? undefined}
        right={
          <Link href={`/sequences/${id}/edit`}>
            <Button variant="outline">
              <Pencil className="h-4 w-4 mr-1.5" />
              {t("edit")}
            </Button>
          </Link>
        }
      />

      <section className="mb-8">
        <h2 className="text-sm font-medium text-muted-foreground mb-3">{t("sections.steps")}</h2>
        {data.steps.length === 0 ? (
          <Card className="p-6">
            <EmptyState icon={Circle} title={t("noSteps")} />
          </Card>
        ) : (
          <SequenceFlowView
            draft={publishedStepsToDraft(data.steps)}
            orgLocale={orgLocale}
            triggerSummary={triggerSummary}
          />
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium text-muted-foreground mb-3">
          {t("sections.enrolments")}
        </h2>
        {enrolments.length === 0 ? (
          <Card className="p-6">
            <EmptyState icon={Circle} title={t("noEnrolments")} />
          </Card>
        ) : (
          <Card className="divide-y divide-border">
            {enrolments.map((e) => (
              <Link
                key={e.id}
                href={`/contacts/${e.contactId}`}
                className="flex items-center justify-between gap-3 p-3 hover:bg-secondary/40 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {resolveContactDisplayName({
                      kind: e.contactKind,
                      firstName: e.contactFirstName,
                      lastName: e.contactLastName,
                    })}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{e.companyName}</p>
                </div>
                <span
                  className={cn(
                    "shrink-0 text-xs font-medium px-2 py-0.5 rounded-full border",
                    e.status === "active"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : e.status === "paused"
                        ? "bg-amber-50 text-amber-700 border-amber-200"
                        : "bg-secondary text-muted-foreground border-border",
                  )}
                >
                  {t(`enrolmentStatus.${e.status}`)}
                </span>
              </Link>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}

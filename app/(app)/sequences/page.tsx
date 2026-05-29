import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus, Zap, Pencil } from "lucide-react";
import { getActiveOrg } from "@/lib/auth/context";
import { getDb } from "@/db/client";
import { listSequencesWithCounts } from "@/db/queries/sequences";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type SeqStatus = "draft" | "published" | "paused";

function deriveStatus(row: { isActive: boolean; hasDraft: boolean }): SeqStatus {
  if (row.isActive) return "published";
  return row.hasDraft ? "draft" : "paused";
}

const STATUS_CLASSES: Record<SeqStatus, string> = {
  published: "bg-emerald-50 text-emerald-700 border-emerald-200",
  draft: "bg-amber-50 text-amber-700 border-amber-200",
  paused: "bg-secondary text-muted-foreground border-border",
};

export default async function SequencesPage() {
  const { activeOrganization } = await getActiveOrg();
  const rows = await listSequencesWithCounts(getDb(), activeOrganization.id);
  const t = await getTranslations("pages.sequences");

  return (
    <div className="max-w-[1400px] mx-auto">
      <PageHeader
        title={t("title")}
        subtitle={t("count", { count: rows.length })}
        right={
          <Link href="/sequences/new">
            <Button>
              <Plus className="h-4 w-4 mr-1.5" />
              {t("new")}
            </Button>
          </Link>
        }
      />

      {rows.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            icon={Zap}
            title={t("empty.title")}
            description={t("empty.description")}
            action={{ label: t("new"), href: "/sequences/new" }}
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => {
            const status = deriveStatus(row);
            return (
              <Link key={row.id} href={`/sequences/${row.id}`} className="group">
                <Card className="p-5 h-full transition-colors group-hover:border-brand-teal/40">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-medium text-foreground leading-snug">{row.name}</h2>
                    <span
                      className={cn(
                        "shrink-0 text-xs font-medium px-2 py-0.5 rounded-full border",
                        STATUS_CLASSES[status],
                      )}
                    >
                      {t(`status.${status}`)}
                    </span>
                  </div>
                  {row.description && (
                    <p className="mt-1.5 text-sm text-muted-foreground line-clamp-2">
                      {row.description}
                    </p>
                  )}
                  <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                    <span>{t("activeEnrolments", { count: row.activeEnrolments })}</span>
                    {row.hasDraft && row.isActive && (
                      <span className="inline-flex items-center gap-1 text-amber-600">
                        <Pencil className="h-3 w-3" />
                        {t("draftPending")}
                      </span>
                    )}
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

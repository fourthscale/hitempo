import { getTranslations } from "next-intl/server";
import { X } from "lucide-react";
import { exitOrgAction } from "@/lib/auth/actions";

export async function ImpersonationBanner({ orgName }: { orgName: string }) {
  const t = await getTranslations("admin.impersonation");

  return (
    <div className="bg-brand-amber/15 border-b border-brand-amber/40 text-amber-900 px-6 py-2 flex items-center justify-between text-sm">
      <span>
        {t.rich("banner", {
          orgName,
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
      </span>
      <form action={exitOrgAction}>
        <button
          type="submit"
          className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-amber-200/50 transition-colors text-xs font-medium"
        >
          <X className="h-3 w-3" /> {t("exit")}
        </button>
      </form>
    </div>
  );
}

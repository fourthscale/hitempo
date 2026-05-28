import { Bell, Search } from "lucide-react";
import { getTranslations } from "next-intl/server";

export async function Topbar() {
  const t = await getTranslations("topbar");

  return (
    <header className="h-16 border-b border-border bg-background flex items-center gap-4 pl-14 pr-4 lg:pl-6 lg:pr-6 shrink-0 sticky top-0 z-10">
      <div className="flex-1 max-w-md">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            // PLACEHOLDER: search is not wired yet — opens a future command palette
            placeholder={t("searchPlaceholder")}
            className="w-full h-10 pl-10 pr-3 lg:pr-16 rounded-md bg-secondary text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
          />
          <kbd className="hidden lg:block absolute right-3 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-[10px] font-medium rounded border border-border bg-background text-muted-foreground">
            ⌘ K
          </kbd>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-3 shrink-0">
        <button
          type="button"
          className="relative p-2 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          aria-label={t("notifications")}
        >
          <Bell className="h-5 w-5" />
          {/* PLACEHOLDER: hard-coded notification dot */}
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-brand-amber" aria-hidden />
        </button>
      </div>
    </header>
  );
}

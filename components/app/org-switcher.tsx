"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { ChevronsUpDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { selectOrgAction } from "@/lib/auth/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type OrgOption = { id: string; name: string };

export function OrgSwitcher({
  orgs,
  activeOrgId,
}: {
  orgs: OrgOption[];
  activeOrgId: string;
}) {
  const t = useTranslations("nav");
  const [isPending, startTransition] = useTransition();
  const activeOrg = orgs.find((o) => o.id === activeOrgId);

  function handleSelect(orgId: string) {
    if (orgId === activeOrgId || isPending) return;
    startTransition(async () => {
      await selectOrgAction(orgId);
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] mt-2",
          "text-sidebar-foreground/60 hover:text-sidebar-foreground/90 transition-colors",
          "bg-transparent border-none p-0 cursor-pointer",
          isPending && "opacity-50 cursor-wait",
        )}
        aria-label={t("switchOrg")}
      >
        <span>{activeOrg?.name}</span>
        <ChevronsUpDown className="h-3 w-3 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {orgs.map((org) => (
          <DropdownMenuItem
            key={org.id}
            onClick={() => handleSelect(org.id)}
            className="gap-2"
          >
            <Check
              className={cn(
                "h-3.5 w-3.5 shrink-0",
                org.id === activeOrgId ? "opacity-100" : "opacity-0",
              )}
            />
            <span className="truncate">{org.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

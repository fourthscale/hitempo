"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  Users,
  CheckSquare,
  Zap,
  MapPin,
  MessageSquare,
  BarChart3,
  Settings,
  Inbox,
  User,
  Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";

type IconKey =
  | "dashboard"
  | "companies"
  | "contacts"
  | "tasks"
  | "sequences"
  | "field"
  | "messages"
  | "reporting"
  | "settings"
  | "inbox";

const ICONS: Record<IconKey, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  companies: Building2,
  contacts: Users,
  tasks: CheckSquare,
  sequences: Zap,
  field: MapPin,
  messages: MessageSquare,
  reporting: BarChart3,
  settings: Settings,
  inbox: Inbox,
};

export type NavItem = {
  href: string;
  label: string;
  icon: IconKey;
  /** Plain single-number badge. Mutually exclusive with `ownership` and
   *  `taskSplit` — keep one. */
  count?: number;
  /** "X / Y" split where X = the number owned by the current user and
   *  Y = the total in the org. Used by Companies and Contacts. */
  ownership?: { owned: number; total: number };
  /** Two stacked counters with user / bot icons, used by Tasks to
   *  separate the rep's manual queue from the agent pipeline. */
  taskSplit?: { user: number; agent: number };
};

export function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5 flex-1">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const isActive =
          item.href === "/dashboard"
            ? pathname === "/dashboard"
            : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
              "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              isActive && "bg-sidebar-accent text-sidebar-accent-foreground",
            )}
          >
            <Icon
              className={cn(
                "h-4 w-4 shrink-0",
                isActive ? "text-brand-teal" : "text-sidebar-foreground/70",
              )}
            />
            <span className="flex-1 truncate">{item.label}</span>
            {item.count !== undefined && (
              <span
                className={cn(
                  "text-xs font-medium px-1.5 py-0.5 rounded",
                  isActive
                    ? "bg-sidebar/40 text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/60",
                )}
              >
                {item.count}
              </span>
            )}
            {item.ownership !== undefined && (
              // X / Y → X is mine, Y is the org total. The owned number is
              // rendered slightly brighter so the rep's own footprint
              // pops at a glance.
              <span
                className={cn(
                  "text-xs font-medium tabular-nums",
                  isActive ? "text-sidebar-accent-foreground" : "text-sidebar-foreground/60",
                )}
              >
                <span className={isActive ? "" : "text-sidebar-foreground/90"}>
                  {item.ownership.owned}
                </span>
                <span className="opacity-60">/{item.ownership.total}</span>
              </span>
            )}
            {item.taskSplit !== undefined && (
              // User-assigned manual tasks + agent-pipeline tasks rendered
              // as two icon-prefixed counters so the rep sees at a glance
              // what's on her plate vs what the agent is handling.
              <span
                className={cn(
                  "flex items-center gap-1.5 text-[11px] font-medium tabular-nums",
                  isActive ? "text-sidebar-accent-foreground" : "text-sidebar-foreground/60",
                )}
              >
                <span className="inline-flex items-center gap-0.5" title="Manual">
                  <User className="h-3 w-3" aria-hidden />
                  {item.taskSplit.user}
                </span>
                <span className="inline-flex items-center gap-0.5" title="Agent">
                  <Bot className="h-3 w-3" aria-hidden />
                  {item.taskSplit.agent}
                </span>
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

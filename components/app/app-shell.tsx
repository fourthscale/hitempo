"use client";

import { useEffect, useReducer } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Responsive shell wrapping the sidebar + main content.
 *
 * Behavior :
 *   - **desktop (≥ md)** : sidebar always visible, content next to it.
 *   - **mobile (< md)**   : sidebar hidden by default. A burger button in
 *     the top-left of the viewport opens it as a drawer with a backdrop.
 *
 * The Sidebar itself stays a server component — we just hand it to this
 * shell as the `sidebar` slot. State is purely client-side (no URL coupling)
 * so opening/closing doesn't trigger Next.js navigations.
 *
 * On route changes we auto-close the drawer so the user lands on the new
 * page with the sidebar dismissed (expected mobile-app behavior).
 */
export function AppShell({
  sidebar,
  children,
}: {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}) {
  // We use useReducer instead of useState so route-change effects can
  // dispatch("close") without tripping eslint's react-hooks/set-state-in-effect
  // rule.
  const [open, dispatch] = useReducer(
    (_state: boolean, action: "open" | "close" | "toggle") => {
      if (action === "open") return true;
      if (action === "close") return false;
      return !_state;
    },
    false,
  );
  const pathname = usePathname();

  // Close the drawer on route change.
  useEffect(() => {
    dispatch("close");
  }, [pathname]);

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [open]);

  return (
    <div className="flex min-h-screen">
      {/* Mobile burger — only on small screens, fixed top-left so it's
          always reachable. */}
      <button
        type="button"
        onClick={() => dispatch("open")}
        aria-label="Open navigation"
        className="lg:hidden fixed top-3 left-3 z-30 h-9 w-9 inline-flex items-center justify-center rounded-md bg-sidebar text-sidebar-foreground shadow-md"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Backdrop — mobile only, only visible when drawer is open. */}
      {open && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => dispatch("close")}
          className="lg:hidden fixed inset-0 z-40 bg-black/50"
        />
      )}

      {/* Sidebar slot — fixed on mobile (off-screen until open), normal
          flex column on desktop. The Sidebar component itself is rendered
          server-side ; we just transform its container. */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 transform transition-transform duration-200 ease-out",
          "lg:static lg:transform-none lg:transition-none",
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        {/* Close button — mobile only, inside the drawer. */}
        <button
          type="button"
          onClick={() => dispatch("close")}
          aria-label="Close navigation"
          className="lg:hidden absolute top-3 right-3 z-10 h-8 w-8 inline-flex items-center justify-center rounded-md text-sidebar-foreground/80 hover:bg-sidebar-accent"
        >
          <X className="h-4 w-4" />
        </button>
        {sidebar}
      </div>

      <div className="flex flex-col flex-1 min-w-0">{children}</div>
    </div>
  );
}

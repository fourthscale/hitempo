"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Error boundary for the authenticated (app) routes.
 *
 * Replaces the default Next.js error overlay with a branded "something went
 * wrong" UI. The `digest` in `error.digest` matches the server-side log so
 * the user can quote it when reporting an issue.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors.appBoundary");

  useEffect(() => {
    // Log to console for client-side observability ; the server side already
    // emits its own structured log + Vercel captures it.
    console.error("[app/error]", error);
  }, [error]);

  return (
    <div className="min-h-[calc(100vh-8rem)] flex flex-col items-center justify-center text-center px-6 gap-4">
      <div className="h-12 w-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <div className="space-y-1 max-w-md">
        <h1 className="font-serif text-xl font-bold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>
      <div className="flex items-center gap-2 pt-2">
        <Button type="button" onClick={() => reset()}>
          {t("retry")}
        </Button>
        <Link href="/dashboard">
          <Button type="button" variant="outline">
            {t("home")}
          </Button>
        </Link>
      </div>
      {error.digest && (
        <p className="text-[10px] text-muted-foreground mt-4 font-mono">
          {t("ref")}: {error.digest}
        </p>
      )}
    </div>
  );
}

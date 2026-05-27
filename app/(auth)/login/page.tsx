import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { signInAction } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/app/logo";

type ErrorKey = "invalid_input" | "invalid_credentials" | "revoked" | "unknown";
type InfoKey = "password_set";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; info?: string }>;
}) {
  const t = await getTranslations("auth.login");
  const { error, info } = await searchParams;
  const errorKey: ErrorKey | undefined =
    error === "invalid_input" || error === "invalid_credentials" || error === "revoked"
      ? error
      : error
        ? "unknown"
        : undefined;
  const infoKey: InfoKey | undefined = info === "password_set" ? info : undefined;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <Logo variant="blue" className="h-14 w-auto mb-8" />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="font-serif text-2xl">{t("title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {infoKey && (
            <div className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {t(`info.${infoKey}`)}
            </div>
          )}
          <form action={signInAction} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="email">{t("email")}</Label>
              <Input id="email" name="email" type="email" required autoComplete="email" />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="password">{t("password")}</Label>
              <Input id="password" name="password" type="password" required autoComplete="current-password" />
            </div>
            {errorKey && <p className="text-sm text-red-600">{t(`errors.${errorKey}`)}</p>}
            <Button type="submit" className="w-full">{t("submit")}</Button>
            <Link href="/forgot-password" className="text-sm text-slate-600 hover:underline text-center">
              {t("forgot")}
            </Link>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

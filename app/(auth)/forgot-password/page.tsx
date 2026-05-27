import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requestPasswordResetAction } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/app/logo";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const t = await getTranslations("auth.forgot");
  const { sent } = await searchParams;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <Logo variant="blue" className="h-14 w-auto mb-8" />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="font-serif text-2xl">{t("title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {sent ? (
            <p className="text-sm text-slate-700">{t("sent")}</p>
          ) : (
            <form action={requestPasswordResetAction} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <Label htmlFor="email">{t("email")}</Label>
                <Input id="email" name="email" type="email" required autoComplete="email" />
              </div>
              <Button type="submit" className="w-full">{t("submit")}</Button>
            </form>
          )}
          <Link href="/login" className="block mt-4 text-sm text-slate-600 hover:underline text-center">
            {t("backToLogin")}
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}

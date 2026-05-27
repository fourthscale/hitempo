import { getTranslations } from "next-intl/server";
import { updatePasswordAction } from "@/lib/auth/actions";
import { SubmitButton } from "@/components/ui/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/app/logo";
import { AuthHashHandler } from "@/components/app/auth-hash-handler";

type ErrorKey = "weak_password" | "session_expired";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const t = await getTranslations("auth.reset");
  const { error } = await searchParams;
  const errorKey: ErrorKey | undefined =
    error === "weak_password" || error === "session_expired" ? error : undefined;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <Logo variant="blue" className="h-14 w-auto mb-8" />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="font-serif text-2xl">{t("title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Drains the #access_token hash fragment that Supabase appends to
              invite / recovery / magic-link redirects, sets the session cookie,
              then strips the hash. The password form below depends on having
              a live session ; otherwise updatePasswordAction would fail. */}
          <AuthHashHandler />
          <form action={updatePasswordAction} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="password">{t("password")}</Label>
              <Input id="password" name="password" type="password" required minLength={6} autoComplete="new-password" />
            </div>
            {errorKey && <p className="text-sm text-red-600">{t(`errors.${errorKey}`)}</p>}
            <SubmitButton className="w-full">{t("submit")}</SubmitButton>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

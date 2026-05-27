import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/app/logo";

export default async function HomePage() {
  const t = await getTranslations("common");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-background">
      <Logo variant="blue" className="h-20 w-auto" />
      <p className="mt-6 text-lg italic text-brand-amber">{t("tagline")}</p>
    </main>
  );
}

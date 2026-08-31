import type { Metadata } from "next";
import Link from "next/link";

import { ErrorScreen } from "@/components/error-screen";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations();

  return { title: t("error.notFound.metaTitle") };
}

export default async function NotFound() {
  const { t } = await getTranslations();

  return (
    <ErrorScreen
      code="404"
      title={t("error.notFound.title")}
      description={t("error.notFound.copy")}
      actions={
        <Link href="/" className="error-screen-primary">
          {t("error.backHome")}
        </Link>
      }
    />
  );
}

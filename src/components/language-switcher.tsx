"use client";

import { Languages } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import { useI18n } from "@/components/locale-provider";
import {
  CZECH_LOCALE,
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  type AppLocale,
  getLocalizedPublicPath,
} from "@/lib/i18n";

function setLocaleCookie(locale: AppLocale) {
  document.cookie = `${LOCALE_COOKIE_NAME}=${locale}; path=/; max-age=31536000; SameSite=Lax`;
}

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, dictionary, setLocale } = useI18n();
  const pathname = usePathname();
  const router = useRouter();

  function switchLocale(nextLocale: AppLocale) {
    setLocaleCookie(nextLocale);
    setLocale(nextLocale);

    if (pathname === "/" || pathname === "/cz") {
      router.push(getLocalizedPublicPath(nextLocale));
      router.refresh();
      return;
    }

    router.refresh();
  }

  const options = [
    { locale: DEFAULT_LOCALE, label: compact ? "SL" : dictionary.common.slovenian },
    { locale: CZECH_LOCALE, label: compact ? "CZ" : dictionary.common.czech },
  ] as const;

  return (
    <div className="language-switcher" aria-label={dictionary.common.language}>
      <Languages className="language-switcher-icon" aria-hidden="true" />
      {options.map((option) => {
        const active = locale === option.locale;

        return (
          <button
            key={option.locale}
            type="button"
            className={active ? "active" : ""}
            aria-pressed={active}
            onClick={() => switchLocale(option.locale)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

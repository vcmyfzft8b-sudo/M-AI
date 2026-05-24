"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

import {
  CZECH_LOCALE,
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  type AppLocale,
  getDictionary,
  getHtmlLang,
  normalizeLocale,
} from "@/lib/i18n";

type LocaleContextValue = {
  locale: AppLocale;
  dictionary: ReturnType<typeof getDictionary>;
  setLocale: (locale: AppLocale) => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

function setLocaleCookie(locale: AppLocale) {
  document.cookie = `${LOCALE_COOKIE_NAME}=${locale}; path=/; max-age=31536000; SameSite=Lax`;
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function translateDynamicText(value: string, ui: Record<string, string>) {
  const normalized = normalizeText(value);

  if (ui[normalized]) {
    return value.replace(normalized, ui[normalized]);
  }

  const dynamicPatterns: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
    [/^Odpri dejanja za (.+)$/u, (match) => `Otevřít akce pro ${match[1]}`],
    [/^Preimenuj (.+)$/u, (match) => `Přejmenovat ${match[1]}`],
    [/^Izbriši (.+)$/u, (match) => `Smazat ${match[1]}`],
    [/^Pokaži (.+)$/u, (match) => `Zobrazit ${match[1]}`],
    [/^Odpri fotografijo (\d+)$/u, (match) => `Otevřít fotku ${match[1]}`],
    [/^Odstrani fotografijo (\d+)$/u, (match) => `Odebrat fotku ${match[1]}`],
    [/^Prikaži korak (\d+)$/u, (match) => `Zobrazit krok ${match[1]}`],
    [/^Novo kodo pošlji čez (.+)$/u, (match) => `Nový kód můžeš poslat za ${match[1]}`],
    [/^Aktivno do (.+)$/u, (match) => `Aktivní do ${match[1]}`],
  ];

  for (const [pattern, replacer] of dynamicPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      return value.replace(normalized, replacer(match));
    }
  }

  return value;
}

function shouldSkipAttributeElement(element: Element | null) {
  return Boolean(
    element?.closest(
      [
        "[data-no-localize]",
        "code",
        "pre",
        ".markdown",
        ".note-tts-document",
        ".lecture-notes-content",
      ].join(","),
    ),
  );
}

function shouldSkipTextElement(element: Element | null) {
  return Boolean(
    element?.closest(
      [
        "[data-no-localize]",
        "[contenteditable='true']",
        "input",
        "textarea",
        "code",
        "pre",
        ".markdown",
        ".note-tts-document",
        ".lecture-notes-content",
      ].join(","),
    ),
  );
}

function localizeDom(ui: Record<string, string>) {
  const translateElementAttributes = (element: Element) => {
    if (shouldSkipAttributeElement(element)) {
      return;
    }

    for (const attribute of ["aria-label", "title", "placeholder"]) {
      const current = element.getAttribute(attribute);
      if (!current) {
        continue;
      }

      const next = translateDynamicText(current, ui);
      if (next !== current) {
        element.setAttribute(attribute, next);
      }
    }
  };

  const translateTextNode = (node: Text) => {
    if (shouldSkipTextElement(node.parentElement)) {
      return;
    }

    const current = node.nodeValue ?? "";
    const next = translateDynamicText(current, ui);
    if (next !== current) {
      node.nodeValue = next;
    }
  };

  const walk = (root: ParentNode) => {
    if (root instanceof Element) {
      translateElementAttributes(root);
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();

    while (node) {
      if (node.nodeType === Node.TEXT_NODE) {
        translateTextNode(node as Text);
      } else if (node instanceof Element) {
        translateElementAttributes(node);
      }

      node = walker.nextNode();
    }
  };

  walk(document.body);
}

export function LocaleProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale: AppLocale;
}) {
  const pathname = usePathname();
  const [locale, setLocaleState] = useState<AppLocale>(normalizeLocale(initialLocale));
  const dictionary = useMemo(() => getDictionary(locale), [locale]);

  useEffect(() => {
    document.documentElement.lang = getHtmlLang(locale);
    document.documentElement.dataset.locale = locale;
  }, [locale]);

  useEffect(() => {
    if (locale !== CZECH_LOCALE) {
      return;
    }

    const timers = new Set<number>();
    const scheduleLocalization = () => {
      for (const delay of [90, 350]) {
        const timer = window.setTimeout(() => {
          timers.delete(timer);
          localizeDom(dictionary.ui);
        }, delay);
        timers.add(timer);
      }
    };

    scheduleLocalization();
    document.addEventListener("click", scheduleLocalization, true);
    document.addEventListener("input", scheduleLocalization, true);
    window.addEventListener("memoai:localize", scheduleLocalization);

    return () => {
      document.removeEventListener("click", scheduleLocalization, true);
      document.removeEventListener("input", scheduleLocalization, true);
      window.removeEventListener("memoai:localize", scheduleLocalization);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [dictionary.ui, locale, pathname]);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      dictionary,
      setLocale(nextLocale) {
        const normalized = normalizeLocale(nextLocale);
        setLocaleCookie(normalized);
        setLocaleState(normalized || DEFAULT_LOCALE);
      },
    }),
    [dictionary, locale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useI18n() {
  const context = useContext(LocaleContext);

  if (!context) {
    throw new Error("useI18n must be used within LocaleProvider.");
  }

  return context;
}

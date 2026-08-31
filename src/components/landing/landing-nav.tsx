"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useT } from "@/components/i18n-provider";
import { LandingLoadingLink } from "@/components/landing-loading-link";
import { LandingLanguagePicker } from "@/components/language-picker";
import { Msym } from "@/components/msym";
import { BRAND_LOCKUP_HEIGHT, BRAND_LOCKUP_SRC, BRAND_LOCKUP_WIDTH, BRAND_SUPPORT_EMAIL, SEO_BRAND_NAME } from "@/lib/brand";
import type { MessageKey } from "@/lib/i18n/messages/keys";

/* The page's own sections, in the order a visitor meets them. */
const MENU_SECTIONS: Array<{ href: string; labelKey: MessageKey }> = [
  { href: "#how-it-works", labelKey: "nav.howItWorks" },
  { href: "#features", labelKey: "nav.features" },
  { href: "#faq", labelKey: "nav.faq" },
];

const MENU_LEGAL: Array<{ href: string; labelKey: MessageKey }> = [
  { href: "/legal/terms-of-use", labelKey: "landing.footer.terms" },
  { href: "/legal/privacy-policy", labelKey: "landing.footer.privacy" },
];

export function LandingNav() {
  const t = useT();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let current = false;

    function onScroll() {
      const y = window.scrollY || 0;
      // Hysteresis so the bar does not flicker around the threshold.
      const next = current ? y > 12 : y > 30;
      if (next !== current) {
        current = next;
        setScrolled(next);
      }
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => {
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  /* The panel covers the page, so the page behind it must not scroll with it,
     and Escape has to close it the way every other overlay here does. */
  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const lockup = (
    <span className="landing-v2-lockup">
      <Image
        src={BRAND_LOCKUP_SRC}
        alt={SEO_BRAND_NAME}
        width={BRAND_LOCKUP_WIDTH}
        height={BRAND_LOCKUP_HEIGHT}
        priority
      />
    </span>
  );

  return (
    <header className={`landing-v2-nav${scrolled ? " is-scrolled" : ""}`}>
      <div className="landing-v2-navbar">
        <Link
          href="#top"
          className="landing-v2-brand"
          aria-label={t("nav.homeBrand", { brand: SEO_BRAND_NAME })}
        >
          {lockup}
        </Link>
        <nav
          aria-label={t("nav.main")}
          style={{ display: "flex", alignItems: "center", gap: "0.7rem", justifyContent: "flex-end" }}
        >
          {/* Desktop keeps the switcher in the bar. Before the CTA: someone who
              landed on the wrong language needs to fix that before they are
              asked to sign up in it. The phone moves it into the menu, where
              there is room for the language's name. */}
          <span className="landing-v2-nav-desktop-only">
            <LandingLanguagePicker />
          </span>
          <LandingLoadingLink href="/auth/continue" className="landing-cta landing-cta-nav landing-cta-light">
            {t("landing.cta.tryFree")}
          </LandingLoadingLink>
          <button
            type="button"
            className="landing-v2-menu-button"
            aria-label={t("nav.openMenu")}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
          >
            <Msym name="menu" size="1.6rem" fill={false} weight={500} />
          </button>
        </nav>
      </div>

      {menuOpen ? (
        <div className="landing-v2-menu" role="dialog" aria-modal="true" aria-label={t("nav.menu")}>
          <div className="landing-v2-menu-top">
            {lockup}
            <button
              type="button"
              className="landing-v2-menu-button"
              aria-label={t("nav.closeMenu")}
              onClick={() => setMenuOpen(false)}
            >
              <Msym name="close" size="1.7rem" fill={false} weight={500} />
            </button>
          </div>

          <div className="landing-v2-menu-scroll">
            {/* The page's own sections. Closing on the way out is the point:
                the anchor scrolls the page behind the panel. */}
            <ul className="landing-v2-menu-links">
              {MENU_SECTIONS.map((item) => (
                <li key={item.href}>
                  <a href={item.href} onClick={() => setMenuOpen(false)}>
                    {t(item.labelKey)}
                    <Msym name="chevron_right" size="1.4rem" fill={false} weight={400} />
                  </a>
                </li>
              ))}
            </ul>

            <div className="landing-v2-menu-group">
              <h2>{t("nav.language")}</h2>
              <LandingLanguagePicker />
            </div>

            <div className="landing-v2-menu-group">
              <h2>{t("landing.footer.support")}</h2>
              <a href={`mailto:${BRAND_SUPPORT_EMAIL}`}>{BRAND_SUPPORT_EMAIL}</a>
              {MENU_LEGAL.map((item) => (
                <Link key={item.href} href={item.href}>
                  {t(item.labelKey)}
                </Link>
              ))}
            </div>
          </div>

          {/* Both links leave the page, which unmounts the panel — there is
              nothing to close on the way out. */}
          <div className="landing-v2-menu-actions">
            <LandingLoadingLink href="/auth/continue" className="landing-cta landing-cta-hero landing-cta-dark">
              {t("landing.cta.signIn")}
            </LandingLoadingLink>
            <LandingLoadingLink href="/auth/continue" className="landing-cta landing-cta-hero landing-cta-light">
              {t("landing.cta.tryFree")}
            </LandingLoadingLink>
          </div>
        </div>
      ) : null}
    </header>
  );
}

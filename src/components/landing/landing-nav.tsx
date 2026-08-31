"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useT } from "@/components/i18n-provider";
import { LandingLoadingLink } from "@/components/landing-loading-link";
import { LandingLanguagePicker } from "@/components/language-picker";
import { BRAND_LOCKUP_HEIGHT, BRAND_LOCKUP_SRC, BRAND_LOCKUP_WIDTH, SEO_BRAND_NAME } from "@/lib/brand";

export function LandingNav() {
  const t = useT();
  const [scrolled, setScrolled] = useState(false);

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

  return (
    <header className={`landing-v2-nav${scrolled ? " is-scrolled" : ""}`}>
      <div className="landing-v2-navbar">
        <Link
          href="#top"
          className="landing-v2-brand"
          aria-label={t("nav.homeBrand", { brand: SEO_BRAND_NAME })}
        >
          <span className="landing-v2-lockup">
            <Image
              src={BRAND_LOCKUP_SRC}
              alt={SEO_BRAND_NAME}
              width={BRAND_LOCKUP_WIDTH}
              height={BRAND_LOCKUP_HEIGHT}
              priority
            />
          </span>
        </Link>
        <nav
          aria-label={t("nav.main")}
          style={{ display: "flex", alignItems: "center", gap: "0.7rem", justifyContent: "flex-end" }}
        >
          {/* Before the CTA: someone who landed on the wrong language needs to
              fix that before they are asked to sign up in it. */}
          <LandingLanguagePicker />
          <LandingLoadingLink href="/auth/continue" className="landing-cta landing-cta-nav landing-cta-light">
            {t("landing.cta.tryFree")}
          </LandingLoadingLink>
        </nav>
      </div>
    </header>
  );
}

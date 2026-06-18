import type { Metadata } from "next";
import Link from "next/link";
import { Mail } from "lucide-react";

import {
  BRAND_NAME,
  PUBLIC_PRIVACY_POLICY_PATH,
  PUBLIC_TERMS_OF_USE_PATH,
  SUPPORT_EMAIL,
} from "@/lib/brand";

export const metadata: Metadata = {
  title: "Podpora",
  alternates: {
    canonical: "/support",
  },
};

export default function PublicSupportPage() {
  return (
    <main className="legal-page">
      <nav className="legal-nav" aria-label="Podpora">
        <Link href="/">{BRAND_NAME}</Link>
      </nav>

      <section className="legal-card">
        <p className="dashboard-overline">Podpora</p>
        <h1>Kontakt in pomoč</h1>
        <p>
          Za pomoč pri prijavi, naročnini, nalaganju gradiv, snemanju ali brisanju računa
          piši na podporo.
        </p>

        <a className="legal-primary-link" href={`mailto:${SUPPORT_EMAIL}`}>
          <Mail className="h-5 w-5" aria-hidden="true" />
          {SUPPORT_EMAIL}
        </a>
      </section>

      <div className="legal-link-grid">
        <Link href={PUBLIC_PRIVACY_POLICY_PATH}>Politika zasebnosti</Link>
        <Link href={PUBLIC_TERMS_OF_USE_PATH}>Pogoji uporabe</Link>
        <Link href="/auth/continue">Prijava v aplikacijo</Link>
      </div>
    </main>
  );
}

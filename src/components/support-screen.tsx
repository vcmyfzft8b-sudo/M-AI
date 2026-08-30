"use client";

import { useRouter } from "next/navigation";

import { InstantLink } from "@/components/instant-link";
import { Msym } from "@/components/msym";
import { HELP_SECTIONS } from "@/lib/help-center";

/**
 * Pomoč, as the redesign draws it: a greeting card, then one grouped card per
 * section.
 *
 * The redesign expands each row in place, because its mock answers are two
 * sentences. The real help centre holds long-form articles (terms, privacy,
 * refunds), so each row keeps its chevron and opens the article — which is what
 * the phone artboard does too.
 */
export function SupportScreen({ basePath = "/app/support" }: { basePath?: string }) {
  const router = useRouter();

  return (
    <div className="memo-support-screen">
      <div className="memo-settings-topbar memo-only-mobile flex">
        <button
          type="button"
          aria-label="Nazaj"
          className="memo-m-round"
          onClick={() => router.push("/app")}
        >
          <Msym name="arrow_back" size="1.5rem" fill={false} weight={500} />
        </button>
      </div>

      <div className="memo-page">
        <h1>Pomoč</h1>

        <div className="memo-help-intro">
          <p>Živjo! Tukaj je ekipa Memo AI.</p>
          <p>Za najhitrejši odgovor preveri spodnje vire.</p>
        </div>

        {HELP_SECTIONS.map((section) => (
          <div key={section.title} className="memo-help-section">
            <h2>{section.title}</h2>
            <div className="memo-help-group">
              {section.items.map((item) => (
                <InstantLink
                  key={item.slug}
                  href={`${basePath}/${item.slug}`}
                  className="memo-help-toggle memo-help-item"
                >
                  <span>{item.title}</span>
                  <Msym name="chevron_right" size="1.4rem" fill={false} weight={400} />
                </InstantLink>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

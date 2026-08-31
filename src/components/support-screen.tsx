"use client";

import { InstantLink } from "@/components/instant-link";
import { Msym } from "@/components/msym";
import { useInstantNavigation } from "@/components/navigation-loading";
import { HELP_SECTIONS } from "@/lib/help-center";

/**
 * Pomoč, as the redesign draws it: one grouped card per section.
 *
 * The redesign expands each row in place, because its mock answers are two
 * sentences. The real help centre holds long-form articles (terms, privacy,
 * refunds), so each row keeps its chevron and opens the article — which is what
 * the phone artboard does too.
 */
export function SupportScreen({ basePath = "/app/support" }: { basePath?: string }) {
  const { navigateWithFeedback, overlay: navigationOverlay, isNavigating } = useInstantNavigation();
  const backHref = basePath === "/app/support" ? "/app" : basePath.replace(/\/support$/, "");

  return (
    <div className="memo-support-screen">
      {navigationOverlay}
      {/* The phone floats the way back over the screen, as the library floats
          its settings control; desktop reaches this screen from the rail and
          needs no back control at all. */}
      <div className="memo-settings-topbar memo-only-mobile flex">
        <button
          type="button"
          aria-label="Nazaj"
          className="memo-m-round"
          aria-busy={isNavigating}
          onClick={() => navigateWithFeedback(backHref)}
        >
          <Msym name="arrow_back" size="1.5rem" fill={false} weight={500} />
        </button>
      </div>

      <div className="memo-screen-scroll">
        <div className="memo-page">
          <div className="memo-support-head">
            <h1>Pomoč</h1>
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
    </div>
  );
}

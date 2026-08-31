"use client";

import { useState } from "react";

import { useT } from "@/components/i18n-provider";
import type { MessageKey } from "@/lib/i18n/messages/keys";

/*
 * The language answer used to promise study material "in another language too",
 * which the app has not done since it started writing every note in the
 * language of the source it was given (see `buildGeneratedContentLanguageInstruction`
 * in src/lib/languages.ts). Translating that claim into four more languages
 * would have spread a promise the product does not keep, so the answer now
 * says what actually happens.
 */
const FAQ_ROWS: Array<{ q: MessageKey; a: MessageKey }> = [
  { q: "landing.faq.processing.q", a: "landing.faq.processing.a" },
  { q: "landing.faq.formats.q", a: "landing.faq.formats.a" },
  { q: "landing.faq.language.q", a: "landing.faq.language.a" },
  { q: "landing.faq.recordings.q", a: "landing.faq.recordings.a" },
  { q: "landing.faq.price.q", a: "landing.faq.price.a" },
];

export function LandingFaq() {
  const t = useT();
  const [open, setOpen] = useState(0);

  return (
    <div data-scroll-reveal="" style={{ display: "grid", gap: 0, borderTop: "1px solid var(--l-line-soft)" }}>
      {FAQ_ROWS.map((row, i) => {
        const on = open === i;
        return (
          <div key={row.q} style={{ borderBottom: "1px solid var(--l-line-soft)" }}>
            <button
              type="button"
              onClick={() => setOpen(on ? -1 : i)}
              aria-expanded={on}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "1.5rem",
                width: "100%",
                padding: "1.35rem 0.25rem",
                border: "none",
                background: "transparent",
                fontFamily: "inherit",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  color: on ? "var(--l-label)" : "var(--l-second)",
                  fontSize: "1.1rem",
                  fontWeight: 650,
                  lineHeight: 1.35,
                  transition: "color 240ms ease",
                }}
              >
                {t(row.q)}
              </span>
              <span
                aria-hidden="true"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  width: "1.75rem",
                  height: "1.75rem",
                  borderRadius: "999px",
                  border: "1px solid var(--l-line)",
                  background: on ? "var(--l-label)" : "transparent",
                  color: on ? "var(--l-canvas)" : "var(--l-second)",
                  fontSize: "1.05rem",
                  fontWeight: 500,
                  lineHeight: 1,
                  paddingBottom: "0.09rem",
                  transform: on ? "rotate(45deg)" : "rotate(0deg)",
                  transition: "transform 320ms cubic-bezier(0.22,1,0.36,1), background 240ms ease, color 240ms ease",
                }}
              >
                +
              </span>
            </button>
            <div
              style={{
                display: "grid",
                gridTemplateRows: on ? "1fr" : "0fr",
                opacity: on ? 1 : 0,
                transition: "grid-template-rows 380ms cubic-bezier(0.22,1,0.36,1), opacity 280ms ease",
              }}
            >
              <p
                style={{
                  overflow: "hidden",
                  margin: 0,
                  paddingRight: "3rem",
                  paddingBottom: on ? "1.4rem" : "0rem",
                  maxWidth: "48rem",
                  color: "var(--l-second)",
                  fontSize: "1rem",
                  lineHeight: 1.6,
                  transition: "padding-bottom 380ms cubic-bezier(0.22,1,0.36,1)",
                }}
              >
                {t(row.a)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

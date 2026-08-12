"use client";

import { useState } from "react";

const FAQ_ROWS = [
  {
    q: "Kako dolgo traja obdelava predavanja?",
    a: "Uro dolgo predavanje je običajno obdelano v nekaj minutah – prepis, zapiski in gradivo za učenje nastanejo skupaj.",
  },
  {
    q: "Katere formate lahko naložim?",
    a: "Zvočne posnetke (mp3, m4a, wav), PDF-je in dokumente, povezave do virov ali kar prilepljeno besedilo.",
  },
  {
    q: "Ali deluje v slovenščini?",
    a: "Da. Prepis in zapiski nastanejo v jeziku predavanja, gradivo za učenje pa lahko dobiš tudi v drugem jeziku.",
  },
  {
    q: "Kaj se zgodi z mojimi posnetki?",
    a: "Posnetki in zapiski ostanejo tvoji – vidiš jih samo ti in jih lahko kadarkoli izbrišeš.",
  },
  {
    q: "Koliko stane?",
    a: "Začneš s 3-dnevnim brezplačnim preizkusom. Plačaš šele, če se odločiš, da nadaljuješ.",
  },
] as const;

export function LandingFaq() {
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
                {row.q}
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
                {row.a}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

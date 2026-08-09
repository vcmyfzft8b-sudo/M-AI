import WebKit

enum EmbeddedBranding {
    static let resourceScheme = "memoai-app"
    static let wordmarkHost = "wordmark"

    static let userScript = WKUserScript(
        source: source,
        injectionTime: .atDocumentStart,
        forMainFrameOnly: true
    )

    private static let source = #"""
        (() => {
          const wordmarkURL = "memoai-app://wordmark/logo.png";
          const styleID = "memoai-embedded-branding";

          const installStyles = () => {
            if (document.getElementById(styleID)) return;
            const style = document.createElement("style");
            style.id = styleID;
            style.textContent = `
              .app-topbar {
                background: var(--canvas, #f2f2f7) !important;
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
              }
              .brand-logo[data-memo-wordmark="true"] .brand-logo-mark {
                width: 8rem !important;
                aspect-ratio: 480 / 148 !important;
              }
              .brand-logo.compact[data-memo-wordmark="true"] .brand-logo-mark {
                width: clamp(8rem, 16vw, 10rem) !important;
              }
              .brand-logo[data-memo-wordmark="true"] .brand-logo-image {
                width: 100% !important;
                height: 100% !important;
                object-fit: contain !important;
              }
            `;
            (document.head || document.documentElement).appendChild(style);
          };

          const upgradeLogos = () => {
            installStyles();
            document.querySelectorAll(".brand-logo").forEach((logo) => {
              const mark = logo.querySelector(":scope > .brand-logo-mark");
              const image = mark?.querySelector("img");
              if (!mark || !image) return;

              const alreadyUpdated = image.src.includes("memo-wordmark.png")
                || image.src.startsWith(wordmarkURL);
              if (!alreadyUpdated) {
                image.src = wordmarkURL;
                image.srcset = "";
                image.alt = "Memo AI";
                image.width = 480;
                image.height = 148;
                mark.removeAttribute("aria-hidden");
              }

              const copy = logo.querySelector(":scope > .brand-logo-copy");
              const name = copy?.querySelector(":scope > strong");
              if (name) name.hidden = true;
              if (copy && !copy.querySelector("small")) copy.hidden = true;
              logo.dataset.memoWordmark = "true";
            });
          };

          const start = () => {
            upgradeLogos();
            new MutationObserver(upgradeLogos).observe(document.documentElement, {
              childList: true,
              subtree: true,
            });
          };

          if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", start, { once: true });
          } else {
            start();
          }
        })();
        """#
}

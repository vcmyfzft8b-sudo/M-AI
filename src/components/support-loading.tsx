"use client";

import { useT } from "@/components/i18n-provider";

const SKELETON_SECTIONS = [
  [0, 1, 2, 3],
  [0, 1, 2],
];

/** The help screen's shapes: one grouped card per section. */
export function SupportIndexLoading() {
  return (
    <div className="memo-support-screen" aria-hidden="true" data-route-skeleton="">
      {/* The way back floats over the screen, as it does on the real one. */}
      <div className="memo-settings-topbar memo-only-mobile flex">
        <span className="memo-m-round app-loading-pill" />
      </div>

      <div className="memo-screen-scroll">
        <div className="memo-page">
          {/* The pill rides inside the real heading, so the row is exactly as
              tall as the loaded one — a pill sized by hand was 10px short of
              the phone's heading and every section below it jumped on
              arrival. */}
          <div className="memo-support-head">
            <h1>
              <span
                className="app-loading-pill"
                style={{ display: "inline-block", height: "1.15rem", width: "7rem" }}
              />
            </h1>
          </div>

          {SKELETON_SECTIONS.map((section, index) => (
            <div key={index} className="memo-help-section">
              <div
                className="app-loading-pill"
                style={{ height: "1.3rem", width: "10rem", marginBottom: "0.85rem" }}
              />
              <div className="memo-help-group">
                {section.map((row) => (
                  <div key={row} className="memo-help-toggle memo-help-item">
                    <span className="app-loading-pill" style={{ height: "1.08rem", width: "45%" }} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const ARTICLE_LINES = ["full", "full", "short", "full", "full", "short"] as const;

/** A single help article: heading, then body lines on the redesign's card. */
export function SupportArticleLoading() {
  const t = useT();

  return (
    <div
      className="memo-support-screen"
      data-route-skeleton=""
      aria-busy="true"
      aria-label={t("support.loadingArticle")}
    >
      <div className="memo-settings-topbar memo-only-mobile flex">
        <span className="memo-m-round app-loading-pill" />
      </div>

      <div className="memo-screen-scroll">
        <div className="memo-page">
          {/* Same reason as the index: the real title element carries the
              margins and the line height, so the body below it does not move
              when the article arrives. */}
          <h1 className="memo-article-title" aria-hidden="true">
            <span
              className="app-loading-pill"
              style={{ display: "inline-block", height: "1.15rem", width: "min(24rem, 70%)" }}
            />
          </h1>

          <div className="memo-help-intro">
            {ARTICLE_LINES.map((line, index) => (
              <span
                key={index}
                className="app-loading-pill"
                style={{ height: "1.02rem", width: line === "short" ? "58%" : "100%" }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

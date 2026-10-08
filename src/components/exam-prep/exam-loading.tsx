"use client";

/** The exam screens' shapes: a heading, then the cards the screen stacks. */
export function ExamLoading() {
  return (
    <div className="memo-support-screen memo-exam-screen" aria-hidden="true" data-route-skeleton="">
      <div className="memo-settings-topbar memo-only-mobile flex">
        <span className="memo-m-round app-loading-pill" />
      </div>

      <div className="memo-screen-scroll">
        <div className="memo-page">
          <div className="memo-exam-head">
            <div>
              <span
                className="app-loading-pill"
                style={{ display: "inline-block", height: "0.78rem", width: "8rem" }}
              />
              <h1>
                <span
                  className="app-loading-pill"
                  style={{ display: "inline-block", height: "1.4rem", width: "12rem" }}
                />
              </h1>
            </div>
          </div>
          {[7.5, 5.4, 12].map((height, index) => (
            <div
              key={index}
              className="memo-exam-card"
              style={{ height: `${height}rem`, marginTop: index === 0 ? 0 : "1.6rem" }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

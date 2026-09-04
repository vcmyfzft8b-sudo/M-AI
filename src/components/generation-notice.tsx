"use client";

import { useT } from "@/components/i18n-provider";

/**
 * The wait every screen in this app shows while something is being made.
 *
 * Lifted out of `lecture-workspace.tsx` when the mindmap needed it too. A screen that invents its
 * own spinner is a screen that looks like it belongs to a different product — and the mindmap had
 * done exactly that, waiting on an emoji while every tab beside it waited on this.
 */

export type GenerationPreview = "notes" | "cards" | "quiz" | "test" | "mindmap" | "palace";

/** The note body a generating note is on its way to becoming. */
const GENERATION_NOTE_PARAGRAPHS = [
  ["full", "full", "short"],
  ["full", "full", "full", "short"],
  ["full", "short"],
] as const;

const GENERATION_QUIZ_OPTIONS = [0, 1, 2, 3];

/** Branch widths down one side of the map, uneven the way a real one's topics are. */
const GENERATION_MAP_BRANCHES = ["72%", "100%", "58%", "86%"];

/** A street's worth of roofline, uneven the way the generated one is. */
const GENERATION_TOWN_HOUSES = ["58%", "100%", "74%", "88%", "62%", "96%"];

/**
 * The ghost of the thing being generated, in the shape that will replace it.
 *
 * Built the way the two route skeletons are — out of the real screen's own
 * measurements rather than out of a spinner that says nothing about what is
 * coming. A wait that ends in a stack of flashcards should look like a stack of
 * flashcards filling in.
 */
export function GenerationSkeleton({ kind }: { kind: GenerationPreview }) {
  if (kind === "notes") {
    return (
      <div className="memo-gen-preview" aria-hidden="true">
        {GENERATION_NOTE_PARAGRAPHS.map((paragraph, index) => (
          <div key={index} className="memo-gen-para">
            <span className="app-loading-pill memo-gen-heading" />
            {paragraph.map((line, lineIndex) => (
              <span
                key={lineIndex}
                className={`app-loading-pill memo-gen-line ${line === "short" ? "short" : ""}`.trim()}
              />
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (kind === "cards") {
    return (
      <div className="memo-gen-preview" aria-hidden="true">
        <div className="memo-gen-deckhead">
          <div className="memo-gen-cardhead">
            <span className="app-loading-pill" />
            <span className="app-loading-pill" />
          </div>
          <span className="app-loading-pill memo-gen-bar cards" />
        </div>
        <div className="memo-gen-face">
          <span className="app-loading-pill" />
          <span className="app-loading-pill" />
        </div>
      </div>
    );
  }

  if (kind === "mindmap") {
    /* The map's own shape: a centre, and branches fanning off both sides of it. */
    return (
      <div className="memo-gen-preview memo-gen-map" aria-hidden="true">
        <div className="memo-gen-map-side">
          {GENERATION_MAP_BRANCHES.map((width, index) => (
            <span key={index} className="app-loading-pill memo-gen-branch" style={{ width }} />
          ))}
        </div>
        <span className="app-loading-pill memo-gen-map-root" />
        <div className="memo-gen-map-side">
          {GENERATION_MAP_BRANCHES.map((width, index) => (
            <span key={index} className="app-loading-pill memo-gen-branch" style={{ width }} />
          ))}
        </div>
      </div>
    );
  }

  if (kind === "palace") {
    /*
     * The town's own chrome, in the places it will be in: the map in one corner,
     * the score and the neighbourhood in the other, and a street of houses that
     * fills in behind them.
     */
    return (
      <div className="memo-gen-preview memo-gen-town" aria-hidden="true">
        <div className="memo-gen-town-hud">
          <span className="app-loading-pill memo-gen-town-map" />
          <div className="memo-gen-town-pills">
            <span className="app-loading-pill memo-gen-town-score" />
            <span className="app-loading-pill memo-gen-town-where" />
          </div>
        </div>
        <div className="memo-gen-town-street">
          {GENERATION_TOWN_HOUSES.map((height, index) => (
            <span
              key={index}
              className="app-loading-pill memo-gen-town-house"
              style={{ height }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (kind === "quiz") {
    return (
      <div className="memo-gen-preview" aria-hidden="true">
        <span className="app-loading-pill memo-gen-bar quiz" />
        <div className="memo-gen-quizcard">
          <span className="app-loading-pill memo-gen-prompt" />
          {GENERATION_QUIZ_OPTIONS.map((option) => (
            <span key={option} className="app-loading-pill memo-gen-option" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="memo-gen-preview" aria-hidden="true">
      <span className="app-loading-pill memo-gen-bar test" />
      <div className="memo-gen-testblock">
        <span className="app-loading-pill memo-gen-prompt" />
        <span className="app-loading-pill memo-gen-testinput" />
      </div>
    </div>
  );
}

/**
 * A stage caption over the ghost of what is being made.
 *
 * The caption carries the one thing a skeleton cannot: these waits run for
 * minutes and move through named stages, and "Ustvarjam kartice" is the
 * difference between a screen that is working and a screen that is stuck. It
 * sits on the panel itself — the panel is already the surface, and the card
 * this used to draw around itself landed as a second card inside the first.
 */
export function StudyGenerationNotice({
  stageCopy,
  bodyCopy,
  preview,
}: {
  stageCopy: string;
  /** Defaults to the generic "this runs in the background" line. */
  bodyCopy?: string;
  preview: GenerationPreview;
}) {
  const t = useT();
  const body = bodyCopy ?? t("study.generatingBody");
  return (
    <div className="memo-gen" role="status" aria-live="polite" aria-busy="true">
      <div className="memo-gen-head">
        <p className="memo-gen-stage">{stageCopy}</p>
        {/* An empty string is a caller saying "the stage line says it all", not a missing one. */}
        {body ? <p className="memo-gen-copy">{body}</p> : null}
        <span className="memo-gen-track" aria-hidden="true">
          <span />
        </span>
      </div>
      <GenerationSkeleton kind={preview} />
    </div>
  );
}

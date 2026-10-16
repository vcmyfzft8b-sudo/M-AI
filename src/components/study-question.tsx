"use client";

import { useLayoutEffect, useRef } from "react";

import { useT } from "@/components/i18n-provider";
import { Msym } from "@/components/msym";

/*
 * Whether an answered question leaves its screen scrolling: the nearest box that scrolls has
 * content past its visible bottom (the page's own bottom padding included, which is why the
 * answers' own bottom is not the test). Without a scrolling box, the nearest that clips and is
 * overflowing, as the landing's phone frame does.
 */
function runsPastScreen(options: HTMLElement) {
  for (let node = options.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;

    if (/(auto|scroll)/.test(overflow)) {
      return node.scrollTop + node.clientHeight < node.scrollHeight - 1;
    }

    if (/(hidden|clip)/.test(overflow) && node.scrollHeight > node.clientHeight + 1) {
      return true;
    }
  }

  return document.documentElement.scrollHeight > window.innerHeight + 1;
}

export function StudyQuizQuestion({
  question,
  order,
  selection,
  onSelect,
  collapseAnswered = false,
}: {
  question: {
    id: string;
    prompt: string;
    options: string[];
    correct_option_idx: number;
  };
  order: number[];
  selection: number | null;
  collapseAnswered?: boolean;
  onSelect: (index: number) => void;
}) {
  const t = useT();
  const optionsRef = useRef<HTMLDivElement>(null);

  /*
   * A missed question keeps all its answers, the right one marked, wherever they fit with the
   * verdict under them. Only when they would run past the bottom of the screen
   * (`collapseAnswered` allows it) do the others go, leaving the picked answer and the right one.
   * Measured once the verdict is on the page, before it is painted.
   */
  useLayoutEffect(() => {
    const options = optionsRef.current;

    if (!options) {
      return;
    }

    delete options.dataset.crowded;

    if (collapseAnswered && selection !== null && selection !== question.correct_option_idx && runsPastScreen(options)) {
      options.dataset.crowded = "true";
    }
  }, [collapseAnswered, question.correct_option_idx, question.id, selection]);

  return (
    <>
      <span className="memo-quiz-eyebrow">{t("quiz.chooseOne")}</span>
      <p className="lecture-quiz-prompt">{question.prompt}</p>
      <div ref={optionsRef} className="lecture-quiz-options">
        {order
          .map((optionIndex, displayIndex) => ({ optionIndex, displayIndex }))
          .map(({ optionIndex, displayIndex }) => {
            const selected = selection === optionIndex;
            const correct =
              selection !== null && optionIndex === question.correct_option_idx;
            const incorrect = selection !== null && selected && !correct;
            return (
              <button
                key={`${question.id}-${optionIndex}`}
                type="button"
                disabled={selection !== null}
                onClick={() => onSelect(optionIndex)}
                className={`lecture-quiz-option ${selected ? "selected" : ""} ${correct ? "correct" : ""} ${incorrect ? "incorrect" : ""}`}
              >
                <span className="lecture-quiz-option-label">
                  {String.fromCharCode(65 + displayIndex)}
                </span>
                <span className="lecture-quiz-option-copy">
                  {question.options[optionIndex] ?? ""}
                </span>
                {correct || incorrect ? (
                  <span className="lecture-quiz-option-mark">
                    <Msym name={correct ? "check" : "close"} size="1.2rem" />
                  </span>
                ) : null}
              </button>
            );
          })}
      </div>
    </>
  );
}

export function StudyPracticeQuestion({
  prompt,
  answer,
  unknown,
  disabled = false,
  showUnknown = true,
  onAnswer,
  onUnknown,
}: {
  prompt: string;
  answer: string;
  unknown: boolean;
  disabled?: boolean;
  showUnknown?: boolean;
  onAnswer: (value: string) => void;
  onUnknown: (value: boolean) => void;
}) {
  const t = useT();
  return (
    <>
      <p className="lecture-practice-prompt">{prompt}</p>
      <textarea
        value={answer}
        onChange={(event) => onAnswer(event.target.value)}
        disabled={unknown || disabled}
        aria-label={t("test.yourAnswer")}
        className="ios-textarea lecture-practice-textarea"
        placeholder={t("test.answerPlaceholder")}
      />
      {showUnknown ? (
        <div className="lecture-practice-controls">
          <label className="lecture-practice-unknown">
            <input
              type="checkbox"
              checked={unknown}
              disabled={disabled}
              onChange={(event) => onUnknown(event.target.checked)}
            />
            {t("test.dontKnow")}
          </label>
        </div>
      ) : null}
    </>
  );
}

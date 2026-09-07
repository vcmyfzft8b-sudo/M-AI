"use client";

import { useT } from "@/components/i18n-provider";
import { Msym } from "@/components/msym";

/** Shared question controls for the study tabs and memory palace. */
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
  return (
    <>
      <span className="memo-quiz-eyebrow">{t("quiz.chooseOne")}</span>
      <p className="lecture-quiz-prompt">{question.prompt}</p>
      <div className="lecture-quiz-options">
        {order
          .map((optionIndex, displayIndex) => ({ optionIndex, displayIndex }))
          .filter(
            ({ optionIndex }) =>
              !collapseAnswered ||
              selection === null ||
              optionIndex === selection ||
              optionIndex === question.correct_option_idx,
          )
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

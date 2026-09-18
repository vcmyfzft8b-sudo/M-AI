import { formatExact, formatPercent } from "@/components/admin/ui";
import type {
  OnboardingAnswer,
  OnboardingBreakdown,
  OnboardingQuestionBreakdown,
} from "@/lib/admin/onboarding";

/**
 * One survey question as a card: the share of each answer as a bar, the
 * percentage beside it and the raw count for anyone checking the arithmetic.
 * The bars are scaled to the most popular answer, so the shape of the
 * distribution reads at a glance, while the percentages are of everyone who
 * answered.
 */
function AnswerRow({ answer, max }: { answer: OnboardingAnswer; max: number }) {
  const width = max > 0 ? Math.max((answer.count / max) * 100, answer.count > 0 ? 2 : 0) : 0;

  return (
    <div className="admin-breakdown-row" data-empty={answer.count === 0 ? "true" : undefined}>
      <span className="admin-breakdown-label" title={answer.label}>
        {answer.label}
      </span>
      <span className="admin-bar-track">
        <span className="admin-bar-fill" style={{ width: `${width}%` }} />
      </span>
      <span className="admin-breakdown-share">{formatPercent(answer.share, 0)}</span>
      <span className="admin-breakdown-count">{formatExact(answer.count)}</span>
    </div>
  );
}

export function QuestionCard({ question }: { question: OnboardingQuestionBreakdown }) {
  const max = Math.max(0, ...question.answers.map((answer) => answer.count));

  return (
    <article className="admin-breakdown-card">
      <header className="admin-breakdown-head">
        <h3 className="admin-breakdown-title">{question.title}</h3>
        <span className="admin-breakdown-meta">
          {formatExact(question.answered)} answered
        </span>
      </header>
      {question.hint && <p className="admin-breakdown-hint">{question.hint}</p>}
      {question.answered === 0 ? (
        <p className="admin-breakdown-empty">Nobody answered this in the window.</p>
      ) : (
        <div className="admin-breakdown-rows">
          {question.answers.map((answer) => (
            <AnswerRow key={answer.value} answer={answer} max={max} />
          ))}
        </div>
      )}
    </article>
  );
}

const GROUPS: Array<{
  group: OnboardingQuestionBreakdown["group"];
  title: string;
  hint: string;
}> = [
  {
    group: "demographics",
    title: "Who they are",
    hint: "Role, school and year, field of study, who the account is for and how they found us.",
  },
  {
    group: "goals",
    title: "What they are after",
    hint: "Motivation, what they are studying for, how much time they mean to put in, and the grade they have against the grade they want.",
  },
  {
    group: "product",
    title: "What drew them in",
    hint: "The one feature they picked as the reason to try Memo AI.",
  },
  {
    group: "legacy",
    title: "Older questions",
    hint: "Answers the current survey no longer collects, kept because the accounts that gave them are still here.",
  },
];

export function OnboardingBreakdownGroups({
  breakdown,
}: {
  breakdown: OnboardingBreakdown;
}) {
  return (
    <>
      {GROUPS.map(({ group, title, hint }) => {
        const questions = breakdown.questions.filter((question) => question.group === group);

        if (questions.length === 0) {
          return null;
        }

        return (
          <div className="admin-breakdown-group" key={group}>
            <div className="admin-breakdown-group-head">
              <h3 className="admin-breakdown-group-title">{title}</h3>
              <p className="admin-section-hint">{hint}</p>
            </div>
            <div className="admin-breakdown-grid">
              {questions.map((question) => (
                <QuestionCard key={question.key} question={question} />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

import { formatExact, formatPercent } from "@/components/admin/ui";
import type {
  OnboardingAnswer,
  OnboardingBreakdown,
  OnboardingQuestionBreakdown,
} from "@/lib/admin/onboarding";

/**
 * One survey question as a card: a donut of the answer shares beside a legend
 * that carries every option with its share and raw count.
 *
 * The donut is for the shape at a glance and the legend for the figures, so
 * neither has to do the other's job: a slice is never labelled with a number
 * and a legend row is never asked to convey proportion. Past five answers
 * the smaller ones fold into one neutral "other" slice — a donut with a dozen
 * slivers reads as noise — but every row still appears in the legend, marked
 * as part of that slice.
 */

/** How many answers get a slice of their own before the rest fold together. */
const MAX_SLICES = 5;

const SIZE = 104;
const STROKE = 20;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

type Slice = {
  key: string;
  label: string;
  count: number;
  share: number;
  /** Index into the categorical series, or `null` for the folded remainder. */
  series: number | null;
};

function toSlices(answers: OnboardingAnswer[], answered: number): Slice[] {
  const chosen = answers.filter((answer) => answer.count > 0);
  const own = chosen.slice(0, MAX_SLICES);
  const rest = chosen.slice(MAX_SLICES);

  const slices: Slice[] = own.map((answer, index) => ({
    key: answer.value,
    label: answer.label,
    count: answer.count,
    share: answer.share,
    series: index,
  }));

  if (rest.length > 0) {
    const count = rest.reduce((sum, answer) => sum + answer.count, 0);

    slices.push({
      key: "__other",
      label: `${rest.length} other answers`,
      count,
      share: answered > 0 ? count / answered : 0,
      series: null,
    });
  }

  return slices;
}

function Donut({ slices, answered }: { slices: Slice[]; answered: number }) {
  // Where each slice starts along the ring, as a running total of the shares
  // before it — worked out ahead of the markup so nothing mutates mid-render.
  const starts: number[] = [];
  let running = 0;

  for (const slice of slices) {
    starts.push(running);
    running += slice.share;
  }

  return (
    <svg
      className="admin-donut"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={SIZE}
      height={SIZE}
      role="img"
      aria-label={slices
        .map((slice) => `${slice.label} ${formatPercent(slice.share, 0)}`)
        .join(", ")}
    >
      {slices.map((slice, index) => {
        const length = CIRCUMFERENCE * slice.share;
        const dashOffset = -(CIRCUMFERENCE * starts[index]);

        return (
          <circle
            key={slice.key}
            className="admin-donut-slice"
            data-series={slice.series ?? "other"}
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            strokeDasharray={`${length} ${CIRCUMFERENCE - length}`}
            strokeDashoffset={dashOffset}
            // Starts at twelve o'clock and runs clockwise, the way a share
            // is usually read.
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          >
            <title>
              {`${slice.label}: ${formatPercent(slice.share, 0)} (${formatExact(slice.count)})`}
            </title>
          </circle>
        );
      })}
      {/* The 2px surface gap between slices, drawn over the joins. */}
      {slices.length > 1 &&
        slices.map((slice, index) => {
          const angle = starts[index] * 2 * Math.PI - Math.PI / 2;
          const inner = RADIUS - STROKE / 2 - 1;
          const outer = RADIUS + STROKE / 2 + 1;

          return (
            <line
              key={`gap-${slice.key}`}
              className="admin-donut-gap"
              x1={SIZE / 2 + inner * Math.cos(angle)}
              y1={SIZE / 2 + inner * Math.sin(angle)}
              x2={SIZE / 2 + outer * Math.cos(angle)}
              y2={SIZE / 2 + outer * Math.sin(angle)}
            />
          );
        })}
      <text
        className="admin-donut-total"
        x={SIZE / 2}
        y={SIZE / 2}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {formatExact(answered)}
      </text>
    </svg>
  );
}

function LegendRow({
  answer,
  series,
}: {
  answer: OnboardingAnswer;
  /** The slice this row belongs to: its own series, the folded one, or none. */
  series: number | "other" | "none";
}) {
  return (
    <div className="admin-breakdown-row" data-empty={answer.count === 0 ? "true" : undefined}>
      <span className="admin-swatch" data-series={series} aria-hidden="true" />
      <span className="admin-breakdown-label" title={answer.label}>
        {answer.label}
      </span>
      <span className="admin-breakdown-share">{formatPercent(answer.share, 0)}</span>
      <span className="admin-breakdown-count">{formatExact(answer.count)}</span>
    </div>
  );
}

export function QuestionCard({ question }: { question: OnboardingQuestionBreakdown }) {
  const slices = toSlices(question.answers, question.answered);

  // Which slice each legend row belongs to: its own series for the first
  // five with a count, the folded slice for the rest, none for a zero.
  const seriesByValue = new Map<string, number | "other" | "none">();
  let seen = 0;

  for (const answer of question.answers) {
    if (answer.count === 0) {
      seriesByValue.set(answer.value, "none");
      continue;
    }

    seriesByValue.set(answer.value, seen < MAX_SLICES ? seen : "other");
    seen += 1;
  }

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
        <div className="admin-breakdown-body">
          <Donut slices={slices} answered={question.answered} />
          <div className="admin-breakdown-rows">
            {question.answers.map((answer) => (
              <LegendRow
                key={answer.value}
                answer={answer}
                series={seriesByValue.get(answer.value) ?? "none"}
              />
            ))}
          </div>
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

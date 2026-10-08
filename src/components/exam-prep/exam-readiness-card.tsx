"use client";

import { useExamFormat } from "@/components/exam-prep/exam-format";
import { Msym } from "@/components/msym";
import type { GradeScaleId } from "@/lib/exam-prep/grade-scales";
import type { ExamReadiness } from "@/lib/exam-prep/model";

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}

function Meter({ label, value, detail }: { label: string; value: number; detail: string }) {
  const percent = clampPercent(value * 100);

  return (
    <div className="memo-exam-meter">
      <div className="memo-exam-meter-label">
        <span>{label}</span>
        <span>{detail}</span>
      </div>
      <div
        className="memo-progress"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
      >
        <div style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/**
 * How close the learner is to the grade they want.
 *
 * Pure: the journey screen, the landing page and the demo all draw it from an
 * `ExamReadiness`. The forecast is shown as a range and only once there is
 * enough first-attempt evidence; before that, the card says what unlocks it.
 */
export function ExamReadinessCard({
  readiness,
  gradeScale,
  targetGrade,
  targetPercent,
  finished = false,
}: {
  readiness: ExamReadiness;
  gradeScale: GradeScaleId;
  targetGrade: string;
  targetPercent: number;
  finished?: boolean;
}) {
  const { t, percent, grade, gradeRange } = useExamFormat();
  const { today, onPlan } = readiness;
  const showPlan = !finished;
  const band = showPlan ? onPlan : today;

  return (
    <section className="memo-exam-card" aria-labelledby="exam-readiness-title">
      <div className="memo-exam-ready-head">
        <h2 id="exam-readiness-title">{t("exam.ready.title")}</h2>
        <span className="memo-exam-target">
          {t("exam.ready.targetLabel")}{" "}
          <strong>
            {t("exam.ready.target", {
              grade: grade(gradeScale, targetGrade),
              percent: Math.round(targetPercent),
            })}
          </strong>
        </span>
      </div>

      {readiness.unlocked ? (
        <>
          <div className="memo-exam-gauge" aria-hidden="true">
            <div
              className="memo-exam-gauge-band"
              style={{ left: `${band.low}%`, width: `${Math.max(1, band.high - band.low)}%` }}
            />
            <div className="memo-exam-gauge-target" style={{ left: `${clampPercent(targetPercent)}%` }}>
              <span>{grade(gradeScale, targetGrade)}</span>
            </div>
            <div className="memo-exam-gauge-dot today" style={{ left: `${today.mid}%` }} />
            {showPlan ? (
              <div className="memo-exam-gauge-dot plan" style={{ left: `${onPlan.mid}%` }} />
            ) : null}
          </div>
          <div className="memo-exam-gauge-scale" aria-hidden="true">
            <span>0</span>
            <span>50</span>
            <span>100 %</span>
          </div>

          <div className="memo-exam-forecasts">
            <div className="memo-exam-forecast">
              <span className="memo-exam-forecast-label">{t("exam.ready.todayLabel")}</span>
              <strong>{t("exam.ready.range", { low: today.low, high: today.high })}</strong>
              <span>
                {t("exam.ready.grade", {
                  grade: gradeRange(gradeScale, today.gradeLow, today.gradeHigh),
                })}
              </span>
            </div>
            {showPlan ? (
              <div className="memo-exam-forecast plan">
                <span className="memo-exam-forecast-label">{t("exam.ready.onPlanLabel")}</span>
                <strong>{t("exam.ready.range", { low: onPlan.low, high: onPlan.high })}</strong>
                <span>
                  {t("exam.ready.grade", {
                    grade: gradeRange(gradeScale, onPlan.gradeLow, onPlan.gradeHigh),
                  })}
                </span>
              </div>
            ) : null}
          </div>

          {showPlan ? (
            <p className="memo-exam-chance">
              <Msym name="trending_up" size="1.25rem" />
              <span>
                {t("exam.ready.chance", {
                  percent: Math.round(onPlan.chanceOfTarget * 100),
                  grade: grade(gradeScale, targetGrade),
                })}
              </span>
            </p>
          ) : null}
        </>
      ) : (
        <div className="memo-exam-locked">
          <div className="memo-exam-meter">
            <div className="memo-exam-meter-label">
              <span>
                <Msym name="lock" size="1rem" fill={false} />{" "}
                {t("exam.ready.locked", { count: readiness.evidenceNeeded })}
              </span>
              <span>
                {t("exam.ready.lockedProgress", {
                  count: Math.floor(Math.min(readiness.evidence, readiness.evidenceNeeded)),
                  needed: readiness.evidenceNeeded,
                })}
              </span>
            </div>
            <div className="memo-progress">
              <div
                style={{
                  width: `${clampPercent((readiness.evidence / readiness.evidenceNeeded) * 100)}%`,
                }}
              />
            </div>
          </div>
          <p>{t("exam.ready.lockedWhy")}</p>
        </div>
      )}

      <div className="memo-exam-meters">
        <Meter
          label={t("exam.ready.coverage")}
          value={readiness.coverage}
          detail={percent(readiness.coverage * 100)}
        />
        <Meter
          label={showPlan ? t("exam.ready.memoryOnPlan") : t("exam.ready.memoryNow")}
          value={showPlan ? readiness.memoryAtExamOnPlan : readiness.memoryNow}
          // A model of memory never promises all of it.
          detail={percent(
            Math.min(99, (showPlan ? readiness.memoryAtExamOnPlan : readiness.memoryNow) * 100),
          )}
        />
        <Meter
          label={t("exam.ready.accuracy")}
          value={readiness.accuracy ?? 0}
          detail={readiness.accuracy == null ? "–" : percent(readiness.accuracy * 100)}
        />
      </div>

      <p className="memo-exam-note">
        {showPlan
          ? t("exam.ready.ifStopped", { percent: Math.round(readiness.memoryAtExamIfStopped * 100) })
          : null}{" "}
        {t("exam.ready.honest")}
      </p>
    </section>
  );
}

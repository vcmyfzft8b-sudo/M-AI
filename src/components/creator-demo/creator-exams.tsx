"use client";

import { useEffect, useState } from "react";

import { useCreatorDemoLectures } from "@/components/creator-demo/creator-demo-provider";
import { ExamBuilderScreen } from "@/components/exam-prep/exam-builder-screen";
import { ExamLoading } from "@/components/exam-prep/exam-loading";
import type { ExamPlanPayload } from "@/lib/exam-prep/model";
import type { AppLectureListItem } from "@/lib/types";

/** The plan builder over the demo library, as an account that has everything. */
export function CreatorExamBuilder({ initialLectures }: { initialLectures: AppLectureListItem[] }) {
  const lectures = useCreatorDemoLectures(initialLectures);

  return (
    <ExamBuilderScreen mode="create" lectures={lectures} hasPaidAccess trialLectureId={null} />
  );
}

/** Editing a demo plan: the plan lives in this tab, so it is read on the client. */
export function CreatorExamEditor({
  planId,
  initialLectures,
}: {
  planId: string;
  initialLectures: AppLectureListItem[];
}) {
  const lectures = useCreatorDemoLectures(initialLectures);
  const [plan, setPlan] = useState<ExamPlanPayload["plan"] | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/exams/${planId}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: ExamPlanPayload | null) => {
        if (!cancelled && payload) {
          setPlan(payload.plan);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [planId]);

  if (!plan) {
    return <ExamLoading />;
  }

  return (
    <ExamBuilderScreen
      mode="edit"
      lectures={lectures}
      hasPaidAccess
      trialLectureId={null}
      initialPlan={plan}
    />
  );
}

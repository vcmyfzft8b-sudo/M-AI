import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiUser } from "@/lib/api-auth";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import { getPracticeTestAttemptForUser } from "@/lib/practice-test";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";

const paramsSchema = z.object({
  id: z.string().uuid(),
  attemptId: z.string().uuid(),
});

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; attemptId: string }> },
) {
  const user = await getApiUser(request);

  if (!user) {
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:practice-test:attempt:get",
    rules: rateLimitPresets.detailRead,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsedParams = paramsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return NextResponse.json({ error: "Neveljavni parametri." }, { status: 400 });
  }

  const lecture = await ensureUserOwnsLecture({
    lectureId: parsedParams.data.id,
    user,
  });

  if (!lecture) {
    return NextResponse.json({ error: "Ni najdeno." }, { status: 404 });
  }

  try {
    const attempt = await getPracticeTestAttemptForUser({
      lectureId: parsedParams.data.id,
      attemptId: parsedParams.data.attemptId,
      userId: user.id,
    });

    return NextResponse.json(attempt);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Poskus ni bil najden." },
      { status: 404 },
    );
  }
}

import { NextResponse } from "next/server";

import { getDiscountWheelState, spinDiscountWheel } from "@/lib/discount-wheel";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Whether this account still has a spin, and what it already won. */
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
  }

  return NextResponse.json(await getDiscountWheelState(user.id));
}

/** Spins the wheel. Idempotent: a second call returns the first prize. */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:discount-wheel:post",
    rules: rateLimitPresets.mutate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  try {
    return NextResponse.json(await spinDiscountWheel(user.id));
  } catch (error) {
    console.error("[discount-wheel] spin failed", error);
    return NextResponse.json(
      { error: "Nagrade ni bilo mogoče shraniti. Poskusi znova." },
      { status: 500 },
    );
  }
}

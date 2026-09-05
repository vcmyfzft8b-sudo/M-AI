import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";

import { getOptionalUser } from "@/lib/auth";
import { parseJsonRequest } from "@/lib/request-validation";
import { isSuperAdmin } from "@/lib/super-admin";
import {
  isRealPersona,
  serializeTestPersona,
  TEST_PERSONA_BILLING,
  TEST_PERSONA_COOKIE,
  TEST_PERSONA_ONBOARDING,
} from "@/lib/test-persona";

const personaSchema = z.object({
  billing: z.enum(TEST_PERSONA_BILLING),
  onboarding: z.enum(TEST_PERSONA_ONBOARDING),
});

/**
 * Puts the signed-in account into a state it is not really in.
 *
 * Everything about who may do this is decided here and in `isSuperAdmin`, not
 * in the panel that calls it: a screen can be hidden, an endpoint has to be
 * shut. Anybody else gets a 404 rather than a 403 — there is nothing to be
 * learned from knowing this exists.
 */
export async function POST(request: Request) {
  const user = await getOptionalUser();

  if (!isSuperAdmin(user)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const parsed = await parseJsonRequest(request, personaSchema, { maxBytes: 1024 });

  if (!parsed.success) {
    return parsed.response;
  }

  const store = await cookies();

  if (isRealPersona(parsed.data)) {
    store.delete(TEST_PERSONA_COOKIE);
  } else {
    store.set(TEST_PERSONA_COOKIE, serializeTestPersona(parsed.data), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      // Long enough to survive a testing session, short enough that a persona
      // left on by accident does not become the way this account sees the app.
      maxAge: 60 * 60 * 12,
    });
  }

  return NextResponse.json({ ok: true, persona: parsed.data });
}

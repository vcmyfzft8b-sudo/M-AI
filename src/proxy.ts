import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Audio is excluded for the same reason images are, and it was missed. The voice clips under
     * /tutor-demo are pre-rendered files with nothing user-specific in them, and running them
     * through here attached a locale cookie and, with it, `max-age=0, must-revalidate` — so
     * auditioning a voice cost a full origin round trip every single time, measured at 626ms
     * against production. They are static assets; they are served as static assets.
     */
    "/((?!_next/static|_next/image|tutor-demo|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp3|wav|m4a|ogg)$).*)",
  ],
};

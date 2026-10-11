import { NextResponse } from "next/server";
import { z } from "zod";

import { insertInto } from "@/lib/admin/db";
import { parseLocale } from "@/lib/i18n/locales";
import { captureRouteError } from "@/lib/monitoring";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { parseJsonRequest } from "@/lib/request-validation";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import {
  APPLICATION_VIDEO_BUCKET,
  applicationSchema,
  invalidFields,
  normalizeReferrer,
} from "@/lib/ugc/creator-application";
import { ipCampaign } from "@/lib/ugc/creator-market.server";
import { MARKET_COUNTRIES, OTHER_COUNTRY } from "@/lib/ugc/creator-program";

const ROUTE = "api:ugc:applications:post";

/**
 * An application to the UGC creator program, from the public page at `/ugc`.
 *
 * Open to anyone: applicants have no account. The answer is a code, not copy — the
 * form shows its own translated message for each — and a list of the fields that
 * failed, so the form can mark them.
 *
 * The sample video is uploaded beforehand (`/api/ugc/applications/video`) and only its
 * path arrives here.
 *
 * One email is one application. Applying again answers `duplicate` and changes
 * nothing, so nobody can overwrite somebody else's application by typing their address.
 */
export async function POST(request: Request) {
  const limited = await enforceRateLimit({
    request,
    route: ROUTE,
    rules: rateLimitPresets.creatorApplication,
  });

  if (limited) {
    return limited;
  }

  const parsed = await parseJsonRequest(request, z.record(z.string(), z.unknown()), { maxBytes: 8_000 });

  if (!parsed.success) {
    return parsed.response;
  }

  const body = parsed.data;

  // The form's hidden "website" field: people never see it, form-filling bots do.
  // Answer as if it worked, so the bot learns nothing.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return NextResponse.json({ status: "received" });
  }

  const result = applicationSchema.safeParse(body);

  if (!result.success) {
    return NextResponse.json({ error: "invalid", fields: invalidFields(body) }, { status: 400 });
  }

  const application = result.data;

  // The campaign of the page that was sent from. A visitor from Slovenia or the Balkans
  // can only have been shown their own (the pages redirect by IP), so their IP decides;
  // anyone else applied on whichever link they had. The country must be that campaign's.
  const market = (await ipCampaign()) ?? (body.market === "balkans" ? "balkans" : "si");

  if (application.country !== OTHER_COUNTRY && !MARKET_COUNTRIES[market].includes(application.country)) {
    return NextResponse.json({ error: "invalid", fields: ["country"] }, { status: 400 });
  }

  const serviceRole = createSupabaseServiceRoleClient();

  // The path is ours (the upload route named it), but the upload itself may not have
  // finished. An application pointing at nothing would leave the admin a blank player.
  if (application.sampleVideoPath) {
    const { error: missing } = await serviceRole.storage
      .from(APPLICATION_VIDEO_BUCKET)
      .createSignedUrl(application.sampleVideoPath, 60);

    if (missing) {
      return NextResponse.json({ error: "invalid", fields: ["sampleVideoPath"] }, { status: 400 });
    }
  }

  const { error } = await insertInto(serviceRole, "ugc_creator_applications", {
    email: application.email,
    full_name: `${application.firstName} ${application.lastName}`,
    country: application.country,
    market,
    age: application.age,
    phone: application.phone,
    referral_code: application.referralCode,
    sample_video_url: application.sampleVideoUrl,
    sample_video_path: application.sampleVideoPath,
    locale: parseLocale(typeof body.locale === "string" ? body.locale : undefined) ?? "en",
    referrer: normalizeReferrer(body.ref),
  });

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ status: "duplicate" });
    }

    captureRouteError(error, { route: ROUTE, operation: "insert_application", request });

    return NextResponse.json({ error: "unavailable" }, { status: 500 });
  }

  return NextResponse.json({ status: "received" });
}

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { getMessages } from "@/lib/i18n/messages";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/lib/i18n/locales";
import { interpolate } from "@/lib/i18n/translate";
import { applePushConfigured, sendApplePush, type PushEnvironment } from "@/lib/mobile/apns";

/**
 * Note notifications: the queue between "the note finished" and "the phone
 * buzzed".
 *
 * The enqueue is a database trigger (migration 0053), so nothing here has to
 * be called for a notification to be *owed* — only for it to be *delivered*.
 * That split is deliberate: the moment a note settles is the end of a long
 * pipeline run, and it should not also be the moment we discover APNs is slow.
 */

const DEVICE_LIMIT = 10;

export type PushKind = "note_ready" | "note_failed";

function asLocale(value: string | null | undefined): Locale {
  const base = (value ?? "").trim().toLowerCase().split("-")[0];
  return (LOCALES as readonly string[]).includes(base) ? base as Locale : DEFAULT_LOCALE;
}

/**
 * A note whose title never arrived would otherwise push the word "null" to a
 * lock screen. The generic noun is the honest fallback.
 */
function alertFor(kind: PushKind, locale: Locale, title: string | null) {
  const messages = getMessages(locale);
  const key = kind === "note_ready" ? "push.noteReady" : "push.noteFailed";
  const named = (title ?? "").trim();
  const subject = named.length > 0 ? named : messages["push.untitledNote"] as string;
  return {
    title: messages[`${key}.title` as keyof typeof messages] as string,
    body: interpolate(messages[`${key}.body` as keyof typeof messages] as string, { title: subject }),
  };
}

export async function registerPushDevice(input: {
  userId: string;
  token: string;
  environment: PushEnvironment;
  locale: string | null;
}) {
  const supabase = createSupabaseServiceRoleClient();
  // `token` is the primary key, so this both registers a new install and moves
  // an existing one to whoever is signed in now. Re-enabling matters: a token
  // Apple once called dead can come back when the app is reinstalled.
  const { error } = await supabase.from("push_devices").upsert({
    token: input.token,
    user_id: input.userId,
    platform: "ios",
    environment: input.environment,
    locale: input.locale,
    last_seen_at: new Date().toISOString(),
    disabled_at: null,
    disabled_reason: null,
  } as never, { onConflict: "token" });
  if (error) throw new Error(error.message);
}

/**
 * Called when a user signs out on a device. Deleting rather than disabling:
 * the next person to sign in on this phone re-registers the same token, and
 * nothing about the previous owner should survive that.
 */
export async function forgetPushDevice(token: string) {
  const supabase = createSupabaseServiceRoleClient();
  const { error } = await supabase.from("push_devices").delete().eq("token", token);
  if (error) throw new Error(error.message);
}

async function disableDevice(token: string, reason: string) {
  await createSupabaseServiceRoleClient()
    .from("push_devices")
    .update({ disabled_at: new Date().toISOString(), disabled_reason: reason.slice(0, 200) } as never)
    .eq("token", token);
}

async function correctEnvironment(token: string, environment: PushEnvironment) {
  await createSupabaseServiceRoleClient()
    .from("push_devices")
    .update({ environment } as never)
    .eq("token", token);
}

type QueueRow = {
  id: string;
  user_id: string;
  lecture_id: string | null;
  kind: PushKind;
  attempts: number;
};

/**
 * Sends what is owed.
 *
 * Safe to call from anywhere, as often as you like: the claim is a conditional
 * update, so two callers racing cannot both take the same row, and a row with
 * no live device to send to is retired rather than retried forever.
 *
 * Returns counts rather than throwing, because every caller is a side channel —
 * a finished pipeline run, an hourly sweep — and none of them should fail
 * because a phone could not be reached.
 */
export async function deliverPendingPushNotifications(limit = 50) {
  const result = { claimed: 0, sent: 0, skipped: 0, failed: 0 };
  if (!applePushConfigured()) return result;

  const supabase = createSupabaseServiceRoleClient();
  const { data: pending } = await supabase
    .from("push_queue")
    .select("id, user_id, lecture_id, kind, attempts")
    .is("sent_at", null)
    // Six attempts over an hourly sweep is most of a day of retrying. Past
    // that the notification is stale enough that delivering it is worse than
    // not: nobody wants to hear a note finished yesterday.
    .lt("attempts", 6)
    .order("created_at", { ascending: true })
    .limit(limit)
    .returns<QueueRow[]>();

  if (!pending?.length) return result;

  for (const row of pending) {
    // The claim. `eq("attempts", row.attempts)` is the compare-and-swap: a
    // second worker that read the same row writes attempts + 1 first and this
    // update matches nothing, so the row is only ever sent by one of them.
    const { data: claimed } = await supabase
      .from("push_queue")
      .update({ attempts: row.attempts + 1 } as never)
      .eq("id", row.id)
      .eq("attempts", row.attempts)
      .select("id")
      .maybeSingle();
    if (!claimed) continue;
    result.claimed += 1;

    const { data: devices } = await supabase
      .from("push_devices")
      .select("token, environment, locale")
      .eq("user_id", row.user_id)
      .is("disabled_at", null)
      .limit(DEVICE_LIMIT)
      .returns<Array<{ token: string; environment: PushEnvironment; locale: string | null }>>();

    if (!devices?.length) {
      // Nothing to send to, and nothing that will change that by retrying.
      await supabase.from("push_queue")
        .update({ sent_at: new Date().toISOString(), last_error: "no device" } as never)
        .eq("id", row.id);
      result.skipped += 1;
      continue;
    }

    let title: string | null = null;
    if (row.lecture_id) {
      const { data: lecture } = await supabase
        .from("lectures")
        .select("title")
        .eq("id", row.lecture_id)
        .maybeSingle<{ title: string | null }>();
      title = lecture?.title ?? null;
    }

    let delivered = false;
    let lastError = "";
    for (const device of devices) {
      const alert = alertFor(row.kind, asLocale(device.locale), title);
      const outcome = await sendApplePush(device.token, device.environment, {
        ...alert,
        data: row.lecture_id ? { lectureId: row.lecture_id } : undefined,
        // One note replaces its own earlier notification rather than stacking
        // a "ready" under a "failed" from the same retry.
        collapseId: row.lecture_id ?? undefined,
      });
      if (outcome.environment !== device.environment && outcome.status !== "failed") {
        await correctEnvironment(device.token, outcome.environment);
      }
      if (outcome.status === "sent") { delivered = true; continue; }
      if (outcome.status === "gone") { await disableDevice(device.token, outcome.reason); continue; }
      lastError = outcome.status === "failed" ? outcome.reason : "wrong environment";
    }

    if (delivered) {
      await supabase.from("push_queue")
        .update({ sent_at: new Date().toISOString(), last_error: null } as never)
        .eq("id", row.id);
      result.sent += 1;
    } else if (!lastError) {
      // Every device was dead. There is no one left to tell.
      await supabase.from("push_queue")
        .update({ sent_at: new Date().toISOString(), last_error: "no live device" } as never)
        .eq("id", row.id);
      result.skipped += 1;
    } else {
      await supabase.from("push_queue")
        .update({ last_error: lastError.slice(0, 500) } as never)
        .eq("id", row.id);
      result.failed += 1;
    }
  }

  return result;
}

/**
 * Fire-and-forget for callers that have just finished a note and should not
 * wait on, or fail because of, a push.
 */
export function flushPushNotifications() {
  if (!applePushConfigured()) return;
  void deliverPendingPushNotifications().catch(() => { /* The sweep will retry. */ });
}

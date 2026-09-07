import type { User } from "@supabase/supabase-js";

/**
 * The one account that can put the app into a state it is not really in.
 *
 * Written here as a literal rather than read from an environment variable or
 * from `admin_users`, and that is the point of it. The panel this gates lets an
 * account tell the app it has a subscription it has not bought and an
 * onboarding it has not done; the set of people who can do that should not be
 * something a deploy setting or a row in a table can widen. Changing it is a
 * code change, a commit and a review.
 *
 * It is deliberately NOT the admin allowlist. Admins read the dashboard;
 * this is a different power and belongs to one person.
 */
const SUPER_ADMIN_EMAIL = "nace.valencic@gmail.com";

/**
 * Whether this session belongs to that account.
 *
 * The address alone is not enough: a Supabase session only proves an email once
 * the address is confirmed, and both the OTP and the Google flows confirm on
 * sign-in. An unconfirmed session claiming the address is refused, as is the
 * preview bypass — it fabricates a user, and a fabricated user must never be
 * able to name its way into this.
 */
export function isSuperAdmin(user: Pick<User, "email" | "email_confirmed_at" | "confirmed_at"> | null | undefined) {
  if (!user) {
    return false;
  }

  const email = typeof user.email === "string" ? user.email.trim().toLowerCase() : "";

  if (email !== SUPER_ADMIN_EMAIL) {
    return false;
  }

  return Boolean(user.email_confirmed_at ?? user.confirmed_at);
}

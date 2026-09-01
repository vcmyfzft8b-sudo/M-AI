import type { User } from "@supabase/supabase-js";

/**
 * Private request header written by the app proxy after Supabase has validated
 * the session. The proxy always removes a client-supplied value before doing
 * anything else, so page renders can safely reuse its result instead of making
 * the same network request to Supabase a second time.
 */
export const VERIFIED_PAGE_USER_HEADER = "x-memo-verified-page-user";

type VerifiedPageUser = {
  id: string;
  email: string | null;
  emailConfirmedAt: string | null;
  confirmedAt: string | null;
  fullName: string | null;
  name: string | null;
  metadataEmail: string | null;
};

function optionalString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function serializeVerifiedPageUser(user: User) {
  const payload: VerifiedPageUser = {
    id: user.id,
    email: optionalString(user.email),
    emailConfirmedAt: optionalString(user.email_confirmed_at),
    confirmedAt: optionalString(user.confirmed_at),
    fullName: optionalString(user.user_metadata?.full_name),
    name: optionalString(user.user_metadata?.name),
    metadataEmail: optionalString(user.user_metadata?.email),
  };

  // Header values must be ASCII. This also keeps names in every supported
  // language round-trippable without relying on a Node-only Buffer API in the
  // proxy runtime.
  return encodeURIComponent(JSON.stringify(payload));
}

export function parseVerifiedPageUser(value: string | null): User | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as Partial<VerifiedPageUser>;

    if (typeof parsed.id !== "string" || parsed.id.length === 0) {
      return null;
    }

    const userMetadata = {
      ...(optionalString(parsed.fullName) ? { full_name: parsed.fullName } : {}),
      ...(optionalString(parsed.name) ? { name: parsed.name } : {}),
      ...(optionalString(parsed.metadataEmail) ? { email: parsed.metadataEmail } : {}),
    };

    return {
      id: parsed.id,
      aud: "authenticated",
      role: "authenticated",
      email: optionalString(parsed.email) ?? undefined,
      email_confirmed_at: optionalString(parsed.emailConfirmedAt) ?? undefined,
      confirmed_at: optionalString(parsed.confirmedAt) ?? undefined,
      app_metadata: {},
      user_metadata: userMetadata,
      identities: [],
      created_at: "",
      updated_at: "",
      is_anonymous: false,
    } as User;
  } catch {
    return null;
  }
}

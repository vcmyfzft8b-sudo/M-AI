/**
 * What went wrong, as a code.
 *
 * It used to carry the sentence as well. The only caller now throws
 * `expectedInputFailure(code)`, which derives the wording from the message catalogue — so the
 * learner reads it in their own language and there is one place the words live rather than two.
 */
export type LinkFetchFailure = {
  code: string;
};

// Node reports every transport-level failure as a bare `TypeError: fetch failed` and
// hangs the real reason off `cause`. When a host resolves to several addresses the
// cause is an AggregateError whose `errors` hold one entry per attempt, so the code we
// care about can sit a couple of levels down.
const TLS_ERROR_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "EPROTO",
  "ERR_SSL_WRONG_VERSION_NUMBER",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

const DNS_ERROR_CODES = new Set(["EAI_AGAIN", "ENOTFOUND"]);

const HOST_NOT_FOUND_FAILURE: LinkFetchFailure = { code: "link_host_not_found" };

const CONNECTION_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

// Older Node builds report some certificate rejections through the message alone, so
// keep a fallback rather than letting those page us as unexpected errors.
const TLS_MESSAGE_FRAGMENTS = ["certificate", "self-signed", "self signed"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function collectFailureDetails(error: unknown) {
  const codes: string[] = [];
  const messages: string[] = [];
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();

    if (!isRecord(current) || seen.has(current)) {
      continue;
    }

    seen.add(current);

    if (typeof current.code === "string") {
      codes.push(current.code);
    }

    if (typeof current.message === "string") {
      messages.push(current.message.toLowerCase());
    }

    if (Array.isArray(current.errors)) {
      queue.push(...current.errors);
    }

    if (current.cause) {
      queue.push(current.cause);
    }
  }

  return { codes, messages };
}

/**
 * Classifies a failed outbound link fetch as a problem with the linked site rather than
 * with us. Returns null for anything unrecognised, so genuine defects keep surfacing.
 */
export function describeLinkFetchFailure(error: unknown): LinkFetchFailure | null {
  const { codes, messages } = collectFailureDetails(error);

  if (
    codes.some((code) => TLS_ERROR_CODES.has(code)) ||
    messages.some((message) =>
      TLS_MESSAGE_FRAGMENTS.some((fragment) => message.includes(fragment)),
    )
  ) {
    return { code: "link_tls_failed" };
  }

  if (codes.some((code) => DNS_ERROR_CODES.has(code))) {
    return HOST_NOT_FOUND_FAILURE;
  }

  if (codes.some((code) => CONNECTION_ERROR_CODES.has(code))) {
    return { code: "link_unreachable" };
  }

  return null;
}

/**
 * Classifies a failed hostname lookup, for the resolver call the SSRF guard makes before
 * it fetches anything. Every getaddrinfo rejection means we could not resolve the host in
 * the user's link, whichever code the platform's resolver picked -- production has seen
 * EBUSY alongside the ENOTFOUND and EAI_AGAIN that `describeLinkFetchFailure` knows about
 * -- so match on the syscall rather than on a list of codes. Returns null for anything
 * that is not a resolver rejection, so genuine defects keep surfacing.
 */
export function describeHostResolutionFailure(error: unknown): LinkFetchFailure | null {
  if (!isRecord(error) || error.syscall !== "getaddrinfo") {
    return null;
  }

  return HOST_NOT_FOUND_FAILURE;
}

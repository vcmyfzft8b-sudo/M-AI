// undici reports every network-level failure — DNS, refused connections, TLS
// handshakes — as a TypeError whose message is "fetch failed", with the real
// error on `cause` (sometimes nested one level further). For a link import that
// failure describes the site the user linked to, not a bug in our code, so it
// must surface as an expected input error instead of reaching Sentry.

type LinkFetchNetworkFailure = {
  message: string;
  code: "link_tls_error" | "link_unreachable";
};

const TLS_CAUSE_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_REVOKED",
  "HOSTNAME_MISMATCH",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

function collectCauseChain(error: unknown) {
  const chain: unknown[] = [];
  let current: unknown = error;

  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    current = (current as { cause?: unknown }).cause;

    if (current) {
      chain.push(current);
    }
  }

  return chain;
}

function isTlsCause(cause: unknown) {
  const code =
    cause && typeof cause === "object" && "code" in cause
      ? String((cause as { code?: unknown }).code ?? "")
      : "";

  if (TLS_CAUSE_CODES.has(code) || code.startsWith("ERR_TLS_")) {
    return true;
  }

  const message = cause instanceof Error ? cause.message.toLowerCase() : "";

  return message.includes("certificate") || message.includes("ssl routines");
}

export function describeLinkFetchNetworkError(
  error: unknown,
): LinkFetchNetworkFailure | null {
  if (!(error instanceof TypeError) || error.message !== "fetch failed") {
    return null;
  }

  if (collectCauseChain(error).some(isTlsCause)) {
    return {
      message:
        "The linked site has a certificate problem, so a secure connection could not be made.",
      code: "link_tls_error",
    };
  }

  return {
    message: "The linked site could not be reached.",
    code: "link_unreachable",
  };
}

import assert from "node:assert/strict";
import test from "node:test";

import { describeLinkFetchNetworkError } from "../src/lib/link-fetch-errors.ts";

function undiciFetchFailure(cause) {
  // undici throws exactly this shape for every network-level failure: a
  // TypeError("fetch failed") with the real error as the cause.
  return new TypeError("fetch failed", { cause });
}

test("classifies the production TLS failure as a certificate problem", () => {
  // The exact failure from Sentry issue 141397429: a linked site whose
  // certificate chain omits the intermediate, so Node cannot verify the leaf.
  const cause = new Error(
    "unable to verify the first certificate; if the root CA is installed locally, try running Node.js with --use-system-ca",
  );
  cause.code = "UNABLE_TO_VERIFY_LEAF_SIGNATURE";

  const failure = describeLinkFetchNetworkError(undiciFetchFailure(cause));

  assert.equal(failure?.code, "link_tls_error");
});

test("classifies other certificate causes as TLS problems", () => {
  for (const code of ["CERT_HAS_EXPIRED", "SELF_SIGNED_CERT_IN_CHAIN", "ERR_TLS_CERT_ALTNAME_INVALID"]) {
    const cause = new Error("handshake failed");
    cause.code = code;
    assert.equal(
      describeLinkFetchNetworkError(undiciFetchFailure(cause))?.code,
      "link_tls_error",
      code,
    );
  }
});

test("finds a TLS cause nested one level down", () => {
  const inner = new Error("self-signed certificate");
  inner.code = "DEPTH_ZERO_SELF_SIGNED_CERT";
  const outer = new Error("connect failed", { cause: inner });

  assert.equal(
    describeLinkFetchNetworkError(undiciFetchFailure(outer))?.code,
    "link_tls_error",
  );
});

test("classifies DNS and connection failures as unreachable", () => {
  for (const code of ["ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "UND_ERR_CONNECT_TIMEOUT"]) {
    const cause = new Error(`network error ${code}`);
    cause.code = code;
    assert.equal(
      describeLinkFetchNetworkError(undiciFetchFailure(cause))?.code,
      "link_unreachable",
      code,
    );
  }
});

test("leaves non-network errors alone", () => {
  assert.equal(describeLinkFetchNetworkError(new Error("fetch failed")), null);
  assert.equal(describeLinkFetchNetworkError(new TypeError("Invalid URL")), null);
  assert.equal(describeLinkFetchNetworkError("fetch failed"), null);
  assert.equal(describeLinkFetchNetworkError(null), null);
});

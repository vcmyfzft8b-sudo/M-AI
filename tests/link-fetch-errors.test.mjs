import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";

import { describeLinkFetchFailure } from "../src/lib/link-fetch-errors.ts";

// The exact error production saw: Sentry recorded `TypeError: fetch failed` chained to
// an "unable to verify the first certificate" cause, from a linked site serving an
// incomplete certificate chain.
test("classifies the incomplete certificate chain that reached production", () => {
  const cause = new Error(
    "unable to verify the first certificate; if the root CA is installed locally, try running Node.js with --use-system-ca",
  );
  cause.code = "UNABLE_TO_VERIFY_LEAF_SIGNATURE";

  assert.deepEqual(describeLinkFetchFailure(new TypeError("fetch failed", { cause })), {
    message: "The link's site has an invalid security certificate.",
    code: "link_tls_failed",
  });
});

test("reads the cause out of an AggregateError when a host has several addresses", () => {
  const first = new Error("connect ECONNREFUSED 192.0.2.1:443");
  first.code = "ECONNREFUSED";
  const second = new Error("connect ECONNREFUSED [2001:db8::1]:443");
  second.code = "ECONNREFUSED";

  const failure = describeLinkFetchFailure(
    new TypeError("fetch failed", { cause: new AggregateError([first, second]) }),
  );

  assert.equal(failure?.code, "link_unreachable");
});

test("separates a missing host from a host that refuses the connection", () => {
  const dns = new Error("getaddrinfo ENOTFOUND example.invalid");
  dns.code = "ENOTFOUND";
  assert.equal(
    describeLinkFetchFailure(new TypeError("fetch failed", { cause: dns })).code,
    "link_host_not_found",
  );

  const reset = new Error("read ECONNRESET");
  reset.code = "ECONNRESET";
  assert.equal(
    describeLinkFetchFailure(new TypeError("fetch failed", { cause: reset })).code,
    "link_unreachable",
  );
});

test("falls back to the message when a certificate rejection carries no code", () => {
  assert.equal(
    describeLinkFetchFailure(
      new TypeError("fetch failed", { cause: new Error("self-signed certificate") }),
    ).code,
    "link_tls_failed",
  );
});

test("leaves anything unrecognised unclassified so real defects still surface", () => {
  assert.equal(describeLinkFetchFailure(new TypeError("x is not a function")), null);
  assert.equal(describeLinkFetchFailure(new Error("Zapiska ni bilo mogoče najti.")), null);
  assert.equal(describeLinkFetchFailure(null), null);
  assert.equal(describeLinkFetchFailure(undefined), null);
});

test("does not reclassify an expected input error that already has a code", () => {
  // ExpectedLectureInputError carries its own `code` (e.g. "link_timeout"); the
  // classifier must not mistake one of those for a transport failure.
  const expected = new Error("The link took too long to respond.");
  expected.name = "ExpectedLectureInputError";
  expected.code = "link_timeout";

  assert.equal(describeLinkFetchFailure(expected), null);
});

test("survives a cause chain that points back at itself", () => {
  const outer = new TypeError("fetch failed");
  outer.cause = outer;

  assert.equal(describeLinkFetchFailure(outer), null);
});

test("classifies the failure Node really produces for a closed port", async () => {
  // Proves the code set matches the runtime rather than our memory of it.
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));

  await assert.rejects(fetch(`http://127.0.0.1:${port}/`), (error) => {
    assert.equal(describeLinkFetchFailure(error).code, "link_unreachable");
    return true;
  });
});

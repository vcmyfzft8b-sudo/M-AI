import assert from "node:assert/strict";
import test from "node:test";

import { en } from "../src/lib/i18n/messages/en.ts";
import {
  PAYWALL_REASONS,
  isPaywallReason,
  paywallPath,
  readPaywallBack,
  withPaywallBack,
} from "../src/lib/paywall-reasons.ts";

test("the paywall link names the feature and the page to return to", () => {
  assert.equal(paywallPath(), "/app/start");
  assert.equal(paywallPath("chat"), "/app/start?for=chat");
  assert.equal(
    paywallPath("listen", "/app/lectures/abc?tab=notes"),
    "/app/start?for=listen&back=%2Fapp%2Flectures%2Fabc%3Ftab%3Dnotes",
  );
});

test("back only ever returns inside the app", () => {
  for (const ok of ["/app", "/app/lectures/abc", "/app/lectures/abc?tab=quiz", "/creator/lectures/demo"]) {
    assert.equal(readPaywallBack(ok), ok);
  }

  for (const bad of [
    "https://evil.example/app",
    "//evil.example/app",
    "/\\evil.example",
    "/apps-elsewhere",
    "/auth/continue",
    "/app/start",
    "/creator/start?for=chat",
    "/app/lectures/abc\n",
    "/app/" + "x".repeat(600),
    "",
    null,
    42,
  ]) {
    assert.equal(readPaywallBack(bad), null, String(bad));
  }
});

test("a server-built paywall link gets the reader's page added, and nothing else does", () => {
  assert.equal(
    withPaywallBack("/app/start?for=locked", "/app/lectures/abc"),
    "/app/start?for=locked&back=%2Fapp%2Flectures%2Fabc",
  );
  assert.equal(withPaywallBack("/app/start", "https://evil.example"), "/app/start");
  assert.equal(withPaywallBack("/app/settings", "/app/lectures/abc"), "/app/settings");
});

test("only known reasons are accepted, and every reason has its copy", () => {
  assert.equal(isPaywallReason("chat"), true);
  assert.equal(isPaywallReason("everything"), false);
  assert.equal(isPaywallReason(undefined), false);

  for (const reason of PAYWALL_REASONS) {
    for (const part of ["title", "benefitTitle", "benefitCopy"]) {
      assert.ok(en[`paywall.reason.${reason}.${part}`], `${reason}.${part}`);
    }
  }
});

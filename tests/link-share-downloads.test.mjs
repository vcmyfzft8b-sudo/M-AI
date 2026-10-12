import assert from "node:assert/strict";
import test from "node:test";

import { isLoginWallUrl } from "../src/lib/link-login-walls.ts";
import { mergeCookieHeaders, shareLinkDownloadUrl } from "../src/lib/link-share-downloads.ts";

// Synthetic share links of the shape SharePoint and OneDrive for Business hand out.
const WORD_SHARE =
  "https://example-my.sharepoint.com/:w:/g/personal/someone_example_org/AbCdEfGh123?e=XyZ123";

test("downloads a shared Word, PowerPoint or PDF document instead of opening it online", () => {
  const download = shareLinkDownloadUrl(new URL(WORD_SHARE));

  assert.ok(download);
  assert.equal(download.searchParams.get("download"), "1");
  assert.equal(download.searchParams.get("e"), "XyZ123");
  assert.equal(download.pathname, new URL(WORD_SHARE).pathname);

  for (const kind of [":p:", ":b:"]) {
    assert.ok(shareLinkDownloadUrl(new URL(`https://example.sharepoint.com/${kind}/s/Team/AbC?e=1`)));
  }
});

test("leaves every other link as it was pasted", () => {
  for (const url of [
    "https://example.sharepoint.com/:x:/s/Team/AbC?e=1",
    "https://example.sharepoint.com/sites/Team/Shared%20Documents/notes.docx",
    `${WORD_SHARE}&download=1`,
    "https://sharepoint.com.example.org/:w:/g/personal/x/AbC",
    "https://en.wikipedia.org/:w:/wiki/Photosynthesis",
  ]) {
    assert.equal(shareLinkDownloadUrl(new URL(url)), null, url);
  }
});

test("carries a session forward, a later cookie replacing an earlier one by name", () => {
  assert.equal(mergeCookieHeaders("", "FedAuth=abc"), "FedAuth=abc");
  assert.equal(
    mergeCookieHeaders("FedAuth=abc; rtFa=1", "FedAuth=def; other=2"),
    "FedAuth=def; rtFa=1; other=2",
  );
  assert.equal(mergeCookieHeaders("", ""), "");
});

// Without the guest cookie a share is sent on to the tenant's sign-in, three hops before the
// identity provider; that is a private link, not a link that redirects too much.
test("recognises SharePoint's sign-in hand-off as a login wall", () => {
  assert.equal(
    isLoginWallUrl(
      "https://example-my.sharepoint.com/personal/someone/_layouts/15/Authenticate.aspx?Source=%2F",
    ),
    true,
  );
});

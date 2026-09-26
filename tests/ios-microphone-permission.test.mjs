import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the app answers WebKit's microphone question itself, for its own pages only", () => {
  const controller = readFileSync(new URL("../ios/MemoAI/WebViewController.swift", import.meta.url), "utf8");
  const handler = controller.slice(controller.indexOf("requestMediaCapturePermissionFor"));
  // `.prompt` showed a website-style "Allow “www.memoai.eu” to use your
  // microphone?" before iOS's own permission, and again after every launch.
  assert.match(handler, /let trusted = frame\.isMainFrame && frame\.request\.url\.map\(AppConfiguration\.isInternal\) == true/);
  assert.match(handler, /decisionHandler\(trusted \? \.grant : \.deny\)/);
  assert.doesNotMatch(handler.slice(0, 900), /decisionHandler\([^)]*\.prompt/);
  // iOS still asks: the usage string that its own prompt shows is present.
  const plist = readFileSync(new URL("../ios/MemoAI/Info.plist", import.meta.url), "utf8");
  assert.match(plist, /<key>NSMicrophoneUsageDescription<\/key>/);
});

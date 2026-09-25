import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";

test("native reconciliation checks later purchases after a delivery or queue failure", {
  skip: process.platform !== "darwin" ? "Requires the Xcode Swift compiler" : false,
}, () => {
  const buildRoot = resolve("ios/build");
  mkdirSync(buildRoot, { recursive: true });
  const directory = mkdtempSync(resolve(buildRoot, "reconciliation-test-"));
  try {
    const executable = resolve(directory, "reconciliation-tests");
    execFileSync("xcrun", ["swiftc", "-parse-as-library",
      "ios/MemoAI/TransactionReconciliation.swift", "ios/Tests/TransactionReconciliationTests.swift",
      "-o", executable], { encoding: "utf8", timeout: 60_000 });
    const output = execFileSync(executable, { encoding: "utf8", timeout: 15_000 });
    assert.match(output, /Transaction reconciliation: 6 scenarios passed/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

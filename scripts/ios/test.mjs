import { spawn, execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

if (process.platform !== "darwin") throw new Error("iOS tests require macOS and Xcode.");
mkdirSync("ios/build", { recursive: true });
const fixture = spawn(process.execPath, ["scripts/ios/fixture-server.mjs"], { stdio: ["ignore", "pipe", "inherit"] });
let simulator;
let xcode;
function cleanup() {
  xcode?.kill("SIGINT");
  fixture.kill();
  if (simulator) {
    try { execFileSync("xcrun", ["simctl", "shutdown", simulator], { stdio: "ignore" }); } catch { /* Already shut down. */ }
  }
}
process.on("SIGINT", () => { cleanup(); process.exit(130); });
process.on("SIGTERM", () => { cleanup(); process.exit(143); });
try {
  await new Promise((resolve, reject) => {
    fixture.once("error", reject);
    fixture.once("exit", code => reject(new Error(`Fixture exited: ${code}`)));
    fixture.stdout.once("data", data => { process.stdout.write(data); resolve(); });
  });
  const runtimes = JSON.parse(execFileSync("xcrun", ["simctl", "list", "runtimes", "-j"], { encoding: "utf8" })).runtimes;
  const runtime = runtimes.filter(r => r.isAvailable && r.identifier.includes("SimRuntime.iOS-")).at(-1);
  if (!runtime) throw new Error("Install an iOS simulator runtime in Xcode Settings → Components.");
  const devices = JSON.parse(execFileSync("xcrun", ["simctl", "list", "devicetypes", "-j"], { encoding: "utf8" })).devicetypes;
  const runtimeVersion = runtime.version.split(".").reduce((v, n, i) => v + Number(n) * 2 ** (16 - i * 8), 0);
  const family = process.env.MEMO_IOS_TEST_DEVICE === "iPad" ? "iPad" : "iPhone";
  const type = devices.filter(d => d.name.startsWith(family) && d.minRuntimeVersion <= runtimeVersion && d.maxRuntimeVersion >= runtimeVersion)
    .sort((a, b) => b.minRuntimeVersion - a.minRuntimeVersion)[0];
  if (!type) throw new Error("No compatible iPhone simulator device type installed.");
  simulator = execFileSync("xcrun", ["simctl", "create", `Memo wrapper QA ${Date.now()}`, type.identifier, runtime.identifier], { encoding: "utf8" }).trim();
  console.log(`Task simulator: ${simulator}`);
  xcode = spawn("xcodebuild", ["-project", "ios/MemoAI.xcodeproj", "-scheme", "MemoAIStoreTests", "-configuration", "Debug",
    "-destination", `platform=iOS Simulator,id=${simulator}`, "-derivedDataPath", "ios/build", "-resultBundlePath", `ios/build/ui-${Date.now()}.xcresult`,
    "-parallel-testing-enabled", "NO", "CODE_SIGNING_ALLOWED=NO", ...process.argv.slice(2), "test"], { stdio: "inherit" });
  process.exitCode = await new Promise((resolve, reject) => { xcode.once("error", reject); xcode.once("exit", code => resolve(code ?? 1)); });
} finally { cleanup(); }

/**
 * Real-browser regression for a document whose URL changes before Next boots.
 * Uses only built-in synthetic creator notes. Run against local or Preview:
 * MEMO_TEST_URL=http://localhost:3000 node scripts/test-shell-hydration.mjs
 * Playwright must be available; PLAYWRIGHT_MODULE_PATH can point to an installed
 * package. Optional: MEMO_TEST_BROWSER=webkit, MEMO_TEST_EXECUTABLE=/path/to/Chrome.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const base = new URL(process.env.MEMO_TEST_URL || "http://localhost:3000");
assert.ok(["localhost", "127.0.0.1"].includes(base.hostname) || base.hostname.endsWith(".vercel.app"), "Use a local or confirmed staging Preview URL");
const browser = await playwright[process.env.MEMO_TEST_BROWSER || "chromium"].launch({
  headless: true,
  ...(process.env.MEMO_TEST_EXECUTABLE ? { executablePath: process.env.MEMO_TEST_EXECUTABLE } : {}),
});
const note = "/lectures/demo-note-mikroekonomija";
try {
  for (const native of [false, true]) {
    const context = await browser.newContext({
      serviceWorkers: "block", viewport: native ? { width: 390, height: 844 } : { width: 1280, height: 850 },
      ...(native ? { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 MemoAI-iOS/1.0" } : {}),
    });
    // Synthetic reproductions must not seed Sentry events or send demo cleanup
    // writes to real API handlers when the context closes.
    await context.route("**/*", route => route.request().method() === "GET"
      ? route.continue() : route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
    for (const [from, to] of [
      [`/creator${note}`, "/creator"],
      ["/creator", `/creator${note}`],
      [`/creator/college${note}`, "/creator/college"],
    ]) {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", e => errors.push(e.message));
      page.on("console", m => { if (m.type() === "error" && /hydration|server rendered|Minified React error/i.test(m.text())) errors.push(m.text()); });
      await page.addInitScript(({ from, to }) => {
        if (location.pathname !== from) return;
        history.replaceState(history.state, "", to);
        const observer = new MutationObserver(() => {
          const grid = document.querySelector(".memo-grid");
          const main = document.querySelector("main.memo-main");
          if (grid && main) {
            window.__serverGrid = grid;
            window.__serverMain = main;
            observer.disconnect();
          }
        });
        observer.observe(document, { childList: true, subtree: true });
      }, { from, to });
      const response = await page.goto(new URL(from, base).href, { waitUntil: "domcontentloaded", timeout: 120000 });
      assert.equal(response.status(), 200);
      const expectNote = to.includes("/lectures/");
      await page.waitForFunction(expectNote => expectNote
        ? !!document.querySelector(".memo-grid.note .memo-note-screen")
        : !!document.querySelector(".memo-grid.home .memo-m-create") && !document.querySelector(".memo-note-screen"), expectNote, { timeout: 45000 });
      await page.waitForTimeout(500);
      assert.equal(new URL(page.url()).pathname, to);
      assert.deepEqual(errors, [], `${native ? "iOS" : "web"}: ${from} -> ${to}`);
      assert.ok(await page.evaluate(() => window.__serverGrid === document.querySelector(".memo-grid") && window.__serverMain === document.querySelector("main.memo-main")), "Hydration must retain the server shell and main nodes");
      console.log(`${native ? "iOS" : "web"}: recovered ${from} -> ${to}, preserved server DOM, no React errors`);
      await page.close();
    }

    // No injected mismatch: exercise the same persistent shell across normal
    // client navigation, including back/forward. No document reload is allowed.
    const page = await context.newPage();
    const errors = [], documents = [];
    page.setDefaultTimeout(45000);
    page.on("pageerror", e => errors.push(e.message));
    page.on("request", r => {
      // Vercel's Preview toolbar loads its own document in an iframe.
      if (r.resourceType() === "document" && r.frame() === page.mainFrame()) documents.push(r.url());
    });
    await page.goto(new URL(`/creator${note}`, base).href, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.locator(".memo-note-screen").waitFor();
    await page.waitForTimeout(700);
    await page.evaluate(() => { window.__shell = document.querySelector(".memo-shell"); });
    // Selecting an actual link and dispatching its ordinary click supports the
    // mobile shell too, where the desktop rail is intentionally hidden.
    for (const path of ["/creator/settings", "/creator"]) {
      await page.locator(`a[href="${path}"]`).first().dispatchEvent("click", { button: 0 });
      await page.waitForURL(url => url.pathname === path, { timeout: 45000 });
      console.log(`normal navigation reached ${path}`);
      await page.waitForTimeout(700);
    }
    await page.goBack(); await page.waitForURL("**/creator/settings");
    await page.goForward(); await page.waitForURL("**/creator");
    await page.locator(".memo-grid.home .memo-m-create").waitFor({ state: "attached" });
    assert.equal(documents.length, 1, "ordinary navigation must stay client-side");
    assert.ok(await page.evaluate(() => window.__shell === document.querySelector(".memo-shell")));
    assert.deepEqual(errors, []);
    console.log(`${native ? "iOS" : "web"}: normal navigation and back/forward preserve the shell`);
    await context.close();
  }
} finally {
  await browser.close();
}

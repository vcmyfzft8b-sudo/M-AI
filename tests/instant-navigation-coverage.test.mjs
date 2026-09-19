import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Every link that goes somewhere in the app has to say it was tapped.
 *
 * A plain `next/link` shows nothing at all until the server answers, which on
 * a phone is a second of a screen that looks like it ignored the touch. The
 * fix is `InstantLink`, which paints the destination's skeleton — or, where the
 * destination has none, a progress bar — in the click frame. This test is the
 * guard: it fails when a new in-app `<Link>` appears anywhere outside the
 * handful of files that carry their own feedback.
 */

function readSource(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

function filesBelow(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);

    return statSync(path).isDirectory() ? filesBelow(path) : [path];
  });
}

/**
 * Files allowed to render a bare `next/link` at an in-app href, each because it
 * already provides feedback some other way. Anything not listed here has to use
 * `InstantLink`.
 */
const FEEDBACK_OF_THEIR_OWN = new Map([
  ["src/components/instant-link.tsx", "the implementation"],
  ["src/components/admin/pending-link.tsx", "the admin dashboard's own pending bar"],
  ["src/components/landing-loading-link.tsx", "the landing CTA's in-button spinner"],
  ["src/components/settings-link-card.tsx", "calls useInstantNavigation itself"],
  ["src/components/support-article-link.tsx", "calls useInstantNavigation itself"],
  ["src/components/dock.tsx", "no importer renders it"],
]);

/** Every `<Link …>` opening tag in a file, with its attributes. */
function linkTags(source) {
  return [...source.matchAll(/<Link(?=[\s/>])[^>]*>/g)].map((match) => match[0]);
}

/** True for an href the app's own router owns — not `#anchor`, not an absolute URL. */
function hasInAppHref(tag) {
  return /href=(?:"\/(?!\/)|\{`\/(?!\/)|\{"\/(?!\/))/.test(tag);
}

test("no in-app <Link> is left without navigation feedback", () => {
  const offenders = [];

  for (const path of [...filesBelow("src/app"), ...filesBelow("src/components")]) {
    if (!path.endsWith(".tsx") || FEEDBACK_OF_THEIR_OWN.has(path)) {
      continue;
    }

    const source = readFileSync(path, "utf8");

    if (!source.includes('from "next/link"')) {
      continue;
    }

    for (const tag of linkTags(source)) {
      if (hasInAppHref(tag)) {
        offenders.push(`${path}: ${tag.replace(/\s+/g, " ").slice(0, 90)}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Use InstantLink (or the admin PendingLink) so the tap shows something:\n${offenders.join("\n")}`,
  );
});

test("the allowlist does not outlive the files it excuses", () => {
  for (const [path, reason] of FEEDBACK_OF_THEIR_OWN) {
    assert.doesNotThrow(
      () => statSync(path),
      `${path} is allowlisted (${reason}) but no longer exists — drop the entry.`,
    );
  }
});

test("navigation feedback is mounted for every route, not just /app and /creator", () => {
  // Without a provider above it `InstantLink` stays an ordinary link, so the
  // legal documents, the auth screens and the landing page depend on this one.
  assert.match(
    readSource("src/app/layout.tsx"),
    /<NavigationFeedbackProvider>\{children\}<\/NavigationFeedbackProvider>/,
  );
});

test("the progress bar clears the iOS status bar", () => {
  // The wrapper's web view runs edge to edge, so a bar at `top: 0` is drawn
  // behind the status bar — feedback nobody can see is the bug this is all for.
  const css = readSource("src/app/redesign.css");
  const bar = css.slice(css.indexOf(".navigation-progress-bar {"));

  assert.match(bar.slice(0, 900), /top: env\(safe-area-inset-top, 0px\);/);
});

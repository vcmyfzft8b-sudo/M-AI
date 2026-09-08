import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The spoken walkthrough, offered on the creator demo, which cannot run one.
 *
 * The demo swaps `window.fetch` for `createCreatorDemoFetch` and answers every
 * `/api/lectures/...` call from fixtures, so the real workspace runs its normal
 * request flow with no account, no database and no AI call. It deliberately
 * answers a route it does not implement with `{ ok: true }` rather than an
 * error, so a stray background call can never put an error banner into somebody's
 * recording.
 *
 * The tutor is not a background call. It is a button, and there is no case for
 * its routes, so pressing Start read the catch-all back as a 200 whose body
 * carried no credentials and no `error` to explain itself. `startSession` throws
 * on exactly that shape, and — because the stub never touches the network — it
 * threw about 20ms after the click, reporting "the walkthrough could not be
 * started" to Sentry from a public marketing page.
 *
 * A walkthrough needs minted realtime keys, which is the one thing a visitor
 * without an account cannot be handed, so the fix is to stop offering it: the
 * pill is dropped in the demo, and dropping it is what this guards. The three
 * halves of the trap are asserted together, because the bug only exists when all
 * of them hold, and any one of them changing should bring somebody back here.
 */

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const demoApi = read("../src/lib/creator-demo/api.ts");
const workspace = read("../src/components/lecture-workspace.tsx");
const tutor = read("../src/components/lecture-tutor.tsx");

/** The body of a `function <name>(` declaration, matched by brace depth. */
function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} has been renamed or removed`);

  const open = source.indexOf("{", source.indexOf(")", start));
  let depth = 0;

  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;

      if (depth === 0) {
        return source.slice(open, index + 1);
      }
    }
  }

  throw new Error(`${name} is unbalanced`);
}

test("the demo API has no answer for the tutor routes", () => {
  const route = functionBody(demoApi, "handleLectureRoute");

  assert.ok(
    !/case "tutor"/.test(route),
    "the demo can now answer a tutor route — if it mints a real session this guard is obsolete, " +
      "and if it does not, check what it returns before putting the pill back",
  );
});

test("an unhandled demo route answers 200 with a body the tutor cannot use", () => {
  const route = functionBody(demoApi, "handleLectureRoute");
  const fallback = route.slice(route.lastIndexOf("default:"));

  assert.match(
    fallback,
    /return json\(\{ ok: true \}\)/,
    "the catch-all is what made a missing tutor case look like success",
  );

  // `json` defaults to 200, so the catch-all is an ok response with no
  // `realtime` and no `error` in it — the exact shape `startSession` throws on.
  assert.match(demoApi, /function json\(body: unknown, status = 200\)/);
});

test("startSession treats an ok response with no credentials as a failure", () => {
  assert.match(
    tutor,
    /if \(!response\.ok \|\| !payload\?\.realtime\) \{\s*throw new Error\(payload\?\.error \?\? t\("tutor\.error\.startFailed"\)\);/,
    "the throw that reported the demo's catch-all to Sentry has moved",
  );
});

test("the creator demo is not offered the tutor pill", () => {
  const tabs = functionBody(workspace, "getNoteTabs");

  assert.match(
    tabs,
    /tab\.id !== "tutor" \|\| !isCreatorDemo/,
    "the demo would offer a walkthrough it cannot start",
  );

  // The filter is only worth anything if the one call site passes the flag.
  assert.match(
    workspace,
    /getNoteTabs\(\{ showsTranscript, isCreatorDemo \}\)/,
    "getNoteTabs is called without the demo flag",
  );
});

test("the tutor is still offered everywhere else", () => {
  const tabs = functionBody(workspace, "getNoteTabs");

  // Guards the fix against overshooting into the real app, where the walkthrough
  // is the second pill in the row and must stay there.
  assert.match(workspace, /id: "tutor",/, "the tutor pill has left NOTE_TABS entirely");
  assert.ok(
    !/tab\.id !== "tutor"(?!\s*\|\| !isCreatorDemo)/.test(tabs),
    "the tutor pill is filtered on something other than the demo flag",
  );
});

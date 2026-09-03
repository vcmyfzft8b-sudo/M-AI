import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The onboarding CTA on a page Chrome has translated.
 *
 * Memo speaks five languages; a learner whose browser speaks a sixth is offered
 * Chrome's page translation, and the one who hit this took it. Translation and
 * React each hold a different opinion about where the button's label lives, and
 * the disagreement only surfaces at the instant the spinner is placed beside it.
 *
 * There is no DOM in the test runner, so the two rules that collide are written
 * out below rather than driven through react-dom: `insertBefore` as the spec
 * defines its failure, and the rewrite Chrome performs on a text node. Both are
 * three lines each, and between them they reproduce the production throw and
 * show what makes it go away.
 */

function element(tag) {
  return { tag, childNodes: [], parentNode: null };
}

function text(value) {
  return { tag: "#text", value, childNodes: [], parentNode: null };
}

function append(parent, child) {
  child.parentNode = parent;
  parent.childNodes.push(child);

  return child;
}

/**
 * `Node.insertBefore`, and the one way it fails: an anchor that is not a child
 * of this parent is a NotFoundError, DOMException code 8. That is the error and
 * the code production reported.
 */
function insertBefore(parent, node, anchor) {
  const at = parent.childNodes.indexOf(anchor);

  if (at === -1) {
    const error = new Error(
      "Failed to execute 'insertBefore' on 'Node': The node before which the new node " +
        "is to be inserted is not a child of this node.",
    );
    error.name = "NotFoundError";
    error.code = 8;

    throw error;
  }

  node.parentNode = parent;
  parent.childNodes.splice(at, 0, node);

  return node;
}

/**
 * What Chrome does when it translates: each text node is re-parented into a
 * pair of <font> wrappers put in its place. Elements are never moved — which is
 * the entire reason wrapping the label fixes this.
 */
function translatePage(node) {
  node.childNodes.forEach((child, index) => {
    if (child.tag !== "#text") {
      translatePage(child);

      return;
    }

    const outer = element("font");

    append(append(outer, element("font")), child);
    outer.parentNode = node;
    node.childNodes[index] = outer;
  });
}

/**
 * React's commit phase, reduced to the line that threw
 * (`react-dom-client.production.js:9189`): place the new host node before the
 * host sibling the fiber tree remembers — the node React itself created, not
 * whatever now sits in that position.
 */
function commitPlacement(parent, node, hostSibling) {
  return hostSibling ? insertBefore(parent, node, hostSibling) : append(parent, node);
}

function readSource(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

test("a bare label is carried out of the button, and the spinner cannot be placed", () => {
  const button = element("button");
  const label = append(button, text("Naprej"));

  append(button, element("svg"));
  translatePage(button);

  // Chrome moved it; React is still holding it as the spinner's host sibling.
  assert.equal(label.parentNode.tag, "font");
  assert.throws(
    () => commitPlacement(button, element("svg"), label),
    (error) => error.name === "NotFoundError" && error.code === 8,
  );
});

test("a wrapped label stays the button's own child, and the spinner lands first", () => {
  const button = element("button");
  const label = append(button, element("span"));

  append(label, text("Naprej"));
  append(button, element("svg"));
  translatePage(button);

  const spinner = commitPlacement(button, element("svg"), label);

  assert.equal(label.parentNode, button);
  assert.equal(button.childNodes.indexOf(spinner), 0);
  // Translated all the same: the rewrite happened inside the span.
  assert.equal(label.childNodes[0].tag, "font");
});

test("the onboarding CTA and the paywall CTA both wrap their label", () => {
  const source = readSource("src/components/onboarding-paywall.tsx");

  assert.match(source, /<span>\{currentStep\.action\}<\/span>/);
  assert.doesNotMatch(source, /^\s*\{currentStep\.action\}$/m);
  assert.match(source, /<span className="memo-paywall-cta-label">/);
});

/**
 * Every other button that shows a spinner beside a label it already had is the
 * same button as the onboarding CTA, and would throw the same way on the same
 * translated page. Onboarding is behind a sign-up; these are not — the capture
 * modal is the app's front door and is reachable unauthenticated on /creator —
 * so they are wrapped before a learner finds them rather than after.
 *
 * The expression each label holds is written out here, so that rewording a
 * label leaves these passing and unwrapping one does not. `t("common.cancel")`
 * is wrapped twice and left bare elsewhere in the same file on purpose: the
 * other cancel buttons never gain a sibling, and bare text beside no spinner is
 * nothing to insert before. Hence the count, and hence the adjacency test below
 * carrying the invariant that actually matters.
 */
const WRAPPED_LABELS = [
  ["src/components/note-source-modal.tsx", 'busyLabel ?? t("capture.stopAndCreate")', 1],
  ["src/components/note-source-modal.tsx", 'busyLabel ?? t("capture.startRecording")', 1],
  ["src/components/note-source-modal.tsx", 't("common.cancel")', 2],
  ["src/components/billing-portal-button.tsx", 't("billing.manageSubscription")', 1],
  [
    "src/components/impersonation-banner.tsx",
    'pending ? t("impersonation.leaving") : t("impersonation.stop")',
    1,
  ],
];

for (const [file, label, count] of WRAPPED_LABELS) {
  test(`${file} wraps {${label}}`, () => {
    const source = readSource(file);
    const expression = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const wrapped = source.match(new RegExp(`<span>\\{${expression}\\}</span>`, "g")) ?? [];

    assert.equal(wrapped.length, count);
  });
}

/**
 * The spinner is what makes this crash reachable: a button whose label never
 * gains a sibling has nothing to insert before. So the guard above is only
 * worth as much as the pairing it assumes — assert that every Loader2 in these
 * three files is followed by a wrapped label rather than a bare one.
 */
test("no spinner in these files sits immediately before a bare label", () => {
  for (const file of new Set(WRAPPED_LABELS.map(([path]) => path))) {
    const lines = readSource(file).split("\n");

    lines.forEach((line, index) => {
      if (!/<Loader2/.test(line)) {
        return;
      }

      // Skip the comment the fix left behind; the label follows it.
      let next = index + 1;

      while (next < lines.length && /^\s*(\{?\s*\/\*|\*|\*\/\}?)/.test(lines[next])) {
        next += 1;
      }

      const sibling = lines[next] ?? "";
      const isBareExpression = /^\s*\{.*\}\s*$/.test(sibling) && !/<[A-Za-z/]/.test(sibling);

      assert.ok(
        !isBareExpression,
        `${file}:${next + 1} is a bare text child next to a spinner — wrap it in a <span>:\n${sibling}`,
      );
    });
  }
});

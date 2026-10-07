import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Each of these was a layout shift or a late first paint that Speed Insights measured in
// production. See docs/performance.md for the numbers behind them.
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the content column is a new element when the layout switches, not a moved one", () => {
  const shell = read("../src/components/app-shell.tsx");

  // Browser back/forward between the library and a note moved <main> 200px with no click
  // to excuse it (0.1 CLS each time). Keyed on the committed route, never on the click.
  assert.match(shell, /<main key=\{isNote \? "note" : "page"\} className="memo-main app-shell-content">/);
  assert.doesNotMatch(shell, /<main key=\{[^}]*isNavigatingToNote/);
});

test("the phone note skeleton paints real content: a working back link", () => {
  const loading = read("../src/components/lecture-loading.tsx");
  const navbar = loading.slice(loading.indexOf('className="memo-m-navbar'));

  assert.match(
    navbar,
    /^className="memo-m-navbar memo-only-mobile flex">\s*<InstantLink href="\/app" aria-label=\{t\("common\.back"\)\} className="memo-m-navbtn">\s*<Msym name="arrow_back"/,
  );
});

test("the note dock keeps the chat bar's width until the listen pill is portalled in", () => {
  const workspace = read("../src/components/lecture-workspace.tsx");
  const css = read("../src/app/redesign.css");

  assert.match(workspace, /data-pill-pending=\{\s*!dockSlot &&\s*activeTabId === "notes"/);
  assert.match(
    css,
    /\.memo-dock:not\(:has\(\.memo-dock-pill\)\):not\(:has\(\.mobile-study-manage-pill\)\):not\(\[data-pill-pending\]\)\s*\.memo-m-chatbar \{\s*width: 100%;/,
  );
});

test("the survey mascot is the preloaded, sized image rather than the raw PNG", () => {
  // Every Memo in the survey is drawn by one figure component, so the image is
  // set up once there rather than per screen.
  const flow = read("../src/components/onboarding-flow.tsx");
  const mascot = read("../src/components/onboarding-mascot.tsx");
  const layout = read("../src/app/layout.tsx");
  const call = 'getImageProps({ src: "/memo-mascot.png", alt: "", width: 320, height: 288 })';

  // The same call as the root layout's preload, so the request is the preloaded one.
  assert.ok(layout.includes(call));
  assert.ok(mascot.includes(`const MASCOT = ${call}.props;`));
  assert.doesNotMatch(flow, /memo-mascot\.png/);
  assert.doesNotMatch(mascot, /src="\/memo-mascot\.png"/);
  // Sized by its intrinsic dimensions, so the box is reserved before the file arrives.
  assert.equal(mascot.match(/src=\{MASCOT\.src\}\s+srcSet=\{MASCOT\.srcSet\}\s+width=\{MASCOT\.width\}\s+height=\{MASCOT\.height\}/g)?.length, 1);
  assert.match(flow, /<MascotFigure/);
});

test("the navigation overlay follows the content column into its replacement", () => {
  const nav = read("../src/components/navigation-loading.tsx");

  // Found while rendering, so it is the column from before the commit that replaced it.
  assert.match(nav, /useLayoutEffect\(\(\) => \{\s*if \(contentHost && !contentHost\.isConnected\) \{\s*refreshHost\(\);/);
});

test("the chat column is only read on note routes", () => {
  const shell = read("../src/components/app-shell.tsx");
  assert.match(shell, /const showsChatColumn = isNoteSkeleton \|\| \(isNote && chatOpen === true\);/);
});

test("a tap back to the current page while another is loading drops that navigation", () => {
  const nav = read("../src/components/navigation-loading.tsx");
  const same = nav.slice(nav.indexOf("if (disabled || targetPathname === currentPathname) {"));
  // A `refresh` navigation may queue its refresh behind the push before returning.
  assert.match(same, /^[^]*?if \(pending\) \{\s*cancelPaintWaitRef\.current\?\.\(\);\s*setPending\(null\);\s*\}\s*router\.push\(href\);\s*(?:(?:\/\/[^\n]*\s*)*if \(options\?\.refresh\) \{[^}]*\}\s*)?return;/);
});

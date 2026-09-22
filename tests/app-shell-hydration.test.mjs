import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { unmapDemoPathname } from "../src/lib/creator-demo/paths.ts";

function load(file, modules) {
  const context = { exports: {}, require(name) {
    assert.ok(name in modules, `Unexpected dependency: ${name}`);
    return modules[name];
  } };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../src/components/${file}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, context);
  return context.exports;
}

// Render the real shell and hook. Only route/context inputs and unrelated UI
// dependencies are substituted; React still renders the complete shell markup.
function shell(initialPathname, clientPathname, { hydrated = false, basePath = null } = {}) {
  const router = { refresh() {}, prefetch() {} };
  const modules = {
    react: React, "react/jsx-runtime": jsx,
    "next/navigation": { usePathname: () => clientPathname, useRouter: () => router },
    "@/components/viewport-portal": { useIsHydrated: () => hydrated },
    "next/image": { default: () => null },
    "@/components/app-layout-context": { AppLayoutProvider: ({ children }) => children({ chatOpen: null, registerChatSlot() {} }) },
    "@/components/creator-demo/creator-demo-context": { useCreatorDemoBasePath: () => basePath },
    "@/components/i18n-provider": { useT: () => key => key },
    "@/components/instant-link": { InstantLink: ({ children, ...props }) => React.createElement("a", props, children) },
    "@/components/lecture-loading": { LectureChatLoading: () => React.createElement("div", null, "Chat loading") },
    "@/components/msym": { Msym: () => null },
    "@/components/navigation-loading": { useNavigationFeedback: () => null },
    "@/components/offline/offline-provider": { useIsOffline: () => false },
    "@/components/use-wheel-to-horizontal": { useChipRowWheelScroll() {} },
    "@/lib/brand": {},
    "@/lib/creator-demo/paths": { unmapDemoPathname },
    "@/lib/safe-router-prefetch": { safeRouterPrefetch() {} },
  };
  modules["@/components/use-shell-pathname"] = load("use-shell-pathname.ts", modules);
  const { AppShell } = load("app-shell.tsx", modules);
  return renderToStaticMarkup(React.createElement(AppShell, { initialPathname, hasPaidAccess: true }, React.createElement("div", { id: "page" })));
}

for (const [initial, client] of [
  ["/app/lectures/note", "/app"],
  ["/app", "/app/lectures/note"],
  ["/app/start", "/app"],
  ["/app/lectures/note", "/app/settings"],
]) {
  test(`hydrating ${initial} with browser pathname ${client} preserves server markup`, () => {
    assert.equal(shell(initial, client), shell(initial, initial));
    assert.equal(shell(initial, client, { hydrated: true }), shell(client, client, { hydrated: true }));
  });
}

test("the creator mounts preserve the same hydration contract", () => {
  for (const basePath of ["/creator", "/creator/college"]) {
    const note = `${basePath}/lectures/note`;
    assert.equal(shell(note, basePath, { basePath }), shell(note, note, { basePath }));
    assert.match(shell(note, basePath, { basePath }), /memo-grid note with-chat/);
    assert.match(shell(note, basePath, { hydrated: true, basePath }), /memo-grid home/);
  }
});

test("a temporarily unavailable client pathname retains the server layout", () => {
  assert.equal(shell("/app/lectures/note", null, { hydrated: true }), shell("/app/lectures/note", "/app/lectures/note"));
});

// Drive the real recovery hook through mount, hydration, effect replay and
// persistent-layout navigation. No browser or request is involved in this unit
// fixture; scripts/test-shell-hydration.mjs exercises actual React hydration.
function recovery({ initial = "/app/lectures/note", client = "/app", hydrated = false } = {}) {
  let state, ref, effect, refreshes = 0;
  const router = { refresh() { refreshes++; } };
  const { useShellPathname: runShellHook } = load("use-shell-pathname.ts", {
    react: {
      useState: init => [state ??= init()],
      useRef: init => ref ??= { current: init },
      useEffect: run => { effect = run; },
    },
    "next/navigation": { usePathname: () => client, useRouter: () => router },
    "@/components/viewport-portal": { useIsHydrated: () => hydrated },
  });
  return {
    render(next = {}) {
      ({ initial = initial, client = client, hydrated = hydrated } = next);
      return runShellHook(initial);
    },
    commit() { effect(); },
    get refreshes() { return refreshes; },
  };
}

test("an initial URL mismatch refreshes the page once after hydration", () => {
  const r = recovery();
  assert.equal(r.render(), "/app/lectures/note");
  r.commit();
  assert.equal(r.refreshes, 0, "do not update the router during hydration");
  assert.equal(r.render({ hydrated: true }), "/app");
  r.commit(); r.commit(); // StrictMode replay must not issue a second refresh.
  assert.equal(r.refreshes, 1);
  assert.equal(r.render({ initial: "/app" }), "/app");
  r.commit();
  assert.equal(r.refreshes, 1, "the refreshed layout must not loop");
});

test("normal loads and later navigation never refresh a persistent layout", () => {
  const r = recovery({ client: "/app/lectures/note" });
  r.render(); r.commit();
  r.render({ hydrated: true }); r.commit();
  for (const client of ["/app", "/app/settings", "/app/lectures/other", "/app/start"]) {
    assert.equal(r.render({ client }), client);
    r.commit();
  }
  assert.equal(r.refreshes, 0);
});

test("a client-only offline shell mount does not try to reconcile a server page", () => {
  const r = recovery({ initial: "/offline", client: "/app", hydrated: true });
  assert.equal(r.render(), "/app"); r.commit();
  assert.equal(r.refreshes, 0);
});

test("a navigation completed during hydration supersedes initial recovery", () => {
  const r = recovery();
  r.render(); r.commit();
  assert.equal(r.render({ client: "/app/settings", hydrated: true }), "/app/settings");
  r.commit();
  r.render({ client: "/app" }); r.commit();
  assert.equal(r.refreshes, 0);
});

test("a null initial client pathname does not invent a mismatch later", () => {
  const r = recovery({ client: null });
  r.render(); r.commit();
  r.render({ client: "/app/lectures/note", hydrated: true }); r.commit();
  assert.equal(r.refreshes, 0);
});

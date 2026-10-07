import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { loadEveryRow } from "../src/lib/admin/paged-rows.ts";

/**
 * PostgREST returns at most 1000 rows per select and says nothing about the
 * rest. The signups chart on /admin/users read profiles in one select and so
 * plotted 1,000 of 5,737 signups; these pin the paging that replaced it.
 */
function fakeTable(total, cap = 1000) {
  const rows = Array.from({ length: total }, (_, index) => ({ index }));
  const calls = [];

  return {
    calls,
    loadPage(from, to) {
      calls.push([from, to]);
      return Promise.resolve({ data: rows.slice(from, Math.min(to + 1, from + cap)), error: null });
    },
  };
}

test("reads past the 1000-row cap", async () => {
  const table = fakeTable(5737);
  const rows = await loadEveryRow((from, to) => table.loadPage(from, to));

  assert.equal(rows.length, 5737);
  assert.deepEqual(
    rows.map((row) => row.index),
    Array.from({ length: 5737 }, (_, index) => index),
  );
  assert.equal(table.calls.length, 6);
});

test("an exact multiple of the page asks once more and stops on the empty page", async () => {
  const table = fakeTable(2000);
  const rows = await loadEveryRow((from, to) => table.loadPage(from, to));

  assert.equal(rows.length, 2000);
  assert.deepEqual(table.calls, [
    [0, 999],
    [1000, 1999],
    [2000, 2999],
  ]);
});

test("an empty window is one call and no rows", async () => {
  const table = fakeTable(0);

  assert.deepEqual(await loadEveryRow((from, to) => table.loadPage(from, to)), []);
  assert.equal(table.calls.length, 1);
});

test("a failed page throws instead of charting a gap as zero signups", async () => {
  await assert.rejects(
    loadEveryRow(() => Promise.resolve({ data: null, error: { message: "boom" } })),
    /boom/,
  );
});

test("the signups chart pages both of its series in a total order", () => {
  const source = readFileSync(new URL("../src/lib/admin/users.ts", import.meta.url), "utf8");
  const growth = source.slice(source.indexOf("export async function getUserGrowth"));
  const body = growth.slice(0, growth.indexOf("\n}\n"));

  assert.equal(body.match(/loadEveryRow/g)?.length, 2);
  assert.equal(body.match(/\.range\(from, to\)/g)?.length, 2);
  assert.equal(body.match(/\.order\("id"/g)?.length, 2);
});

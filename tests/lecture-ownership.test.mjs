import assert from "node:assert/strict";
import test from "node:test";

import { lectureRowMatchesOwner } from "../src/lib/lecture-ownership.ts";

const OWNER = "6ca1f0f0-4a5f-4b0a-9a3a-9a6d1b0d1e01";
const OTHER_USER = "0d2e7c9b-1f3d-4f5a-8c2b-3e4f5a6b7c8d";
const LECTURE = "bdb9c830-d7db-400c-b253-1ee490259731";
const OTHER_LECTURE = "8b69a01e-6193-4d0a-830b-414f15926e77";

const row = (overrides) => ({ id: LECTURE, user_id: OWNER, ...overrides });
const asking = { lectureId: LECTURE, userId: OWNER };

test("reuses the row ensureUserOwnsLecture just returned", () => {
  // The whole point: this row is what the second ownership query would have fetched, so the
  // detail load can skip that query instead of running it again under the 8s timeout.
  assert.equal(lectureRowMatchesOwner(row(), asking), true);
});

test("refuses a row belonging to a different user", () => {
  // The one that matters. A row that passed some other user's ownership check must never be
  // accepted as proof for this one — it falls through to the query, which applies the filter.
  assert.equal(lectureRowMatchesOwner(row({ user_id: OTHER_USER }), asking), false);
});

test("refuses a row for a different lecture", () => {
  assert.equal(lectureRowMatchesOwner(row({ id: OTHER_LECTURE }), asking), false);
});

test("refuses a row whose id or owner is missing, empty or not a string", () => {
  // A partially selected row must not read as a match through two undefineds comparing equal.
  assert.equal(lectureRowMatchesOwner({}, { lectureId: undefined, userId: undefined }), false);
  assert.equal(lectureRowMatchesOwner(row({ user_id: "" }), { ...asking, userId: "" }), false);
  assert.equal(lectureRowMatchesOwner(row({ id: null }), asking), false);
  assert.equal(lectureRowMatchesOwner(row({ user_id: { id: OWNER } }), asking), false);
});

test("callers that did not pre-check fall through to the lookup", () => {
  // study, quiz and practice-test pass nothing: for them the lookup IS the ownership check.
  assert.equal(lectureRowMatchesOwner(undefined, asking), false);
  assert.equal(lectureRowMatchesOwner(null, asking), false);
});

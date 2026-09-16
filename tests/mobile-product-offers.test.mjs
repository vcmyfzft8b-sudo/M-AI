import assert from "node:assert/strict";
import test from "node:test";
import { nativeProducts, halfOffProducts, trialPlanProducts } from "../src/lib/mobile/products.ts";

const monthly = { id: "eu.memoai.premium.monthly", name: "Monthly", price: "€19.99", quote: "apple-quote", available: true };

test("the wheel only advertises an eligible Apple half-price offer", () => {
  assert.deepEqual(halfOffProducts([monthly]), []);
  assert.deepEqual(halfOffProducts([{ ...monthly, halfOff: true }]), []);
  assert.deepEqual(halfOffProducts([{ ...monthly, introPrice: "€10.00", halfOff: false }]), []);
  const halfOff = { ...monthly, introPrice: "€10.00", halfOff: true };
  assert.deepEqual(halfOffProducts([halfOff]), [halfOff]);
  assert.deepEqual(halfOffProducts([{ ...halfOff, available: false }]), []);
});

test("missing prices, unsupported offers and products without a purchase quote stay unavailable", () => {
  for (const value of [null, {}, [null], [{ ...monthly, id: "unknown" }],
    [{ ...monthly, quote: undefined }], [{ ...monthly, available: false }],
    [{ ...monthly, price: "" }], [{ ...monthly, introPrice: 10 }]]) {
    assert.deepEqual(nativeProducts(value), []);
  }
  assert.deepEqual(nativeProducts([monthly]), [monthly]);
});


test("three-day trials have their own presentation and cannot qualify for the wheel", () => {
  const trial = { ...monthly, trialDays: 3 };
  assert.deepEqual(nativeProducts([trial]), [trial]);
  assert.deepEqual(halfOffProducts([trial]), []);
  for (const invalid of [
    { ...trial, trialDays: 7 }, { ...trial, introPrice: "€0.00" },
    { ...trial, halfOff: true }, { ...trial, trialDays: "3" },
  ]) assert.deepEqual(nativeProducts([invalid]), []);
});


test("ordinary signup and wheel select separate products without inventing trial eligibility", () => {
  const discount = { ...monthly, introPrice: "€9.99", halfOff: true };
  const trial = { ...monthly, id: "eu.memoai.premium.trial.monthly", trialDays: 3 };
  const ineligible = { ...monthly, id: "eu.memoai.premium.trial.yearly" };
  assert.deepEqual(trialPlanProducts([discount, trial, ineligible]), [trial, ineligible]);
  assert.deepEqual(halfOffProducts([discount, trial, ineligible]), [discount]);
});

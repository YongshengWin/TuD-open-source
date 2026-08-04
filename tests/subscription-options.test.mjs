import assert from "node:assert/strict";
import test from "node:test";
import {
  addBillingCycle,
  billingCycleMonths,
  currencyFractionDigits,
  isAutoRenewableCycle,
  isBillingCycle,
  isSupportedCurrency,
  majorToMinor,
  minorToMajor,
} from "../lib/subscription-options.ts";

test("supports all subscription cycles", () => {
  for (const cycle of ["monthly", "quarterly", "semiannual", "yearly", "biennial", "triennial", "custom", "lifetime"]) {
    assert.equal(isBillingCycle(cycle), true);
  }
  assert.equal(isBillingCycle("weekly"), false);
  assert.equal(billingCycleMonths("quarterly"), 3);
  assert.equal(billingCycleMonths("semiannual"), 6);
  assert.equal(billingCycleMonths("triennial"), 36);
  assert.equal(isAutoRenewableCycle("custom"), false);
  assert.equal(isAutoRenewableCycle("lifetime"), false);
});

test("advances renewal dates without month-end overflow", () => {
  assert.equal(addBillingCycle("2027-01-31", "monthly"), "2027-02-28");
  assert.equal(addBillingCycle("2028-01-31", "monthly"), "2028-02-29");
  assert.equal(addBillingCycle("2028-02-29", "yearly"), "2029-02-28");
  assert.equal(addBillingCycle("2027-01-31", "quarterly"), "2027-04-30");
  assert.equal(addBillingCycle("2027-04-30", "semiannual"), "2027-10-30");
  assert.equal(addBillingCycle("2027-03-15", "biennial"), "2029-03-15");
  assert.equal(addBillingCycle("2027-03-15", "triennial"), "2030-03-15");
  assert.throws(() => addBillingCycle("2027-03-15", "custom"));
  assert.throws(() => addBillingCycle("2027-03-15", "lifetime"));
});

test("uses each currency's actual minor unit", () => {
  for (const currency of ["CNY", "USD", "EUR", "GBP", "JPY", "HKD", "TWD", "KRW", "SGD", "AUD", "CAD", "CHF", "KWD"]) {
    assert.equal(isSupportedCurrency(currency), true);
  }
  assert.equal(currencyFractionDigits("JPY"), 0);
  assert.equal(currencyFractionDigits("KWD"), 3);
  assert.equal(majorToMinor(1200, "JPY"), 1200);
  assert.equal(majorToMinor(12.345, "KWD"), 12345);
  assert.equal(minorToMajor(12345, "KWD"), 12.345);
});

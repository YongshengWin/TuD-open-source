import assert from "node:assert/strict";
import test from "node:test";
import { convertMonthlySpend, formatCurrencyAmount, formatMonthlySpend, formatSubscriptionDate, monthlySpendByCurrency } from "../lib/subscription-display.ts";

test("adds a non-breaking space between currency symbols and amounts", () => {
  assert.equal(formatCurrencyAmount(98, "CNY", 2), "¥\u00a098.00");
  assert.equal(formatCurrencyAmount(200, "USD", 2), "US$\u00a0200.00");
  assert.equal(formatCurrencyAmount(1, "JPY", 0), "JP¥\u00a01");
});

test("shows the full renewal year and rejects invalid dates", () => {
  assert.match(formatSubscriptionDate("2039-12-19"), /^2039\/12\/19\s/);
  assert.equal(formatSubscriptionDate("2039-02-31"), "未设置日期");
  assert.equal(formatSubscriptionDate(""), "未设置日期");
});

test("calculates exact monthly equivalents separately for each currency", () => {
  const totals = monthlySpendByCurrency([
    { amountMinor: 12000, billingCycle: "yearly", currencyCode: "CNY" },
    { amountMinor: 3000, billingCycle: "quarterly", currencyCode: "CNY" },
    { amountMinor: 20000, billingCycle: "monthly", currencyCode: "USD" },
    { amountMinor: 999, billingCycle: "custom", currencyCode: "USD" },
  ]);
  assert.deepEqual(totals, [
    { currency: "CNY", amount: 20 },
    { currency: "USD", amount: 200 },
  ]);
  assert.equal(formatMonthlySpend(200, "USD"), "US$\u00a0200.00");
});

test("converts and totals monthly spending into the selected currency", () => {
  const total = convertMonthlySpend([
    { currency: "CNY", amount: 70 },
    { currency: "USD", amount: 10 },
  ], "EUR", { USD: 1, CNY: 7, EUR: 0.9 });
  assert.equal(total, 18);
  assert.equal(convertMonthlySpend([{ currency: "CAD", amount: 4 }], "EUR", { USD: 1, EUR: 0.9 }), null);
});

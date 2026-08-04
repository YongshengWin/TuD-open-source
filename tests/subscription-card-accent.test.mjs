import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSubscriptionCardAccent } from "../lib/subscription-card-accent.ts";

test("normalizes subscription card accents for database persistence", () => {
  assert.equal(normalizeSubscriptionCardAccent("#A1B2C3"), "a1b2c3");
  assert.equal(normalizeSubscriptionCardAccent(" 0F8F83 "), "0f8f83");
  assert.equal(normalizeSubscriptionCardAccent(null), null);
  assert.equal(normalizeSubscriptionCardAccent(""), null);
});

test("rejects malformed subscription card accents", () => {
  for (const value of ["#fff", "abcdef00", "violet", "12 3456", 123456, {}, true]) {
    assert.throws(() => normalizeSubscriptionCardAccent(value), /卡片颜色格式不正确/);
  }
});

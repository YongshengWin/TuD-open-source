import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCompleteSubscriptionOrder,
  groupSubscriptionsByCategory,
  normalizeSubscriptionOrder,
} from "../lib/subscription-order.ts";

test("normalizes an explicit unique subscription order", () => {
  assert.deepEqual(normalizeSubscriptionOrder(["sub-2", "sub-1"]), ["sub-2", "sub-1"]);
  assert.deepEqual(normalizeSubscriptionOrder([]), []);
  assert.throws(() => normalizeSubscriptionOrder("sub-1"), /格式/);
  assert.throws(() => normalizeSubscriptionOrder(["sub-1", "sub-1"]), /重复/);
  assert.throws(() => normalizeSubscriptionOrder([" sub-1"]), /无效/);
});

test("keeps subscriptions from the same category together in category order", () => {
  const grouped = groupSubscriptionsByCategory([
    { id: "server-2", groupName: "服务器", sortPosition: 4 },
    { id: "ai-1", groupName: "AI", sortPosition: 1 },
    { id: "server-1", groupName: "服务器", sortPosition: 2 },
    { id: "other", groupName: "未排序", sortPosition: 0 },
  ], ["AI", "服务器"]);
  assert.deepEqual(grouped.map((item) => item.id), ["ai-1", "server-1", "server-2", "other"]);
});

test("requires the exact user-owned subscription set", () => {
  assert.doesNotThrow(() => assertCompleteSubscriptionOrder(["sub-2", "sub-1"], ["sub-1", "sub-2"]));
  assert.throws(() => assertCompleteSubscriptionOrder(["sub-1"], ["sub-1", "sub-2"]), /全部订阅/);
  assert.throws(() => assertCompleteSubscriptionOrder(["sub-1", "other-user-sub"], ["sub-1", "sub-2"]), /无权访问/);
});

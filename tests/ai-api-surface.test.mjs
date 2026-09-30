import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("AI API exposes every user-owned management surface through bearer authorization", async () => {
  const routes = await Promise.all([
    "../app/api/ai/v1/categories/route.ts",
    "../app/api/ai/v1/icons/route.ts",
    "../app/api/ai/v1/icons/discover/route.ts",
    "../app/api/ai/v1/icons/monogram/route.ts",
    "../app/api/ai/v1/preferences/route.ts",
    "../app/api/ai/v1/subscriptions/order/route.ts",
    "../app/api/ai/v1/subscriptions/[id]/restore/route.ts",
  ].map(source));

  for (const route of routes) {
    assert.match(route, /authorizeAiRequest\(request\)/);
    assert.match(route, /unauthorizedAiResponse\(\)/);
  }
});

test("OpenAPI contract requires real icons and documents the complete lifecycle", async () => {
  const [openapi, guide, contract] = await Promise.all([
    source("../app/api/ai/v1/openapi/route.ts"),
    source("../app/settings/ai/ai-settings-panel.tsx"),
    source("../lib/ai-api-contract.ts"),
  ]);

  assert.match(openapi, /required: \["name", "iconId"\]/);
  assert.match(openapi, /else: \{ required: \["dueDate"\] \}/);
  assert.match(openapi, /"\/icons\/discover"/);
  assert.match(openapi, /"429": \{ description: "请求过于频繁；Retry-After/);
  assert.match(openapi, /"\/icons\/monogram"/);
  assert.match(openapi, /"\/categories"/);
  assert.match(openapi, /"\/preferences"/);
  assert.match(openapi, /permanent=true/);
  assert.match(openapi, /custom 和 lifetime 不可自动推进/);
  assert.match(guide, /不得猜测.*iconId/);
  assert.match(guide, /永久删除不可恢复/);
  assert.match(contract, /"cardAccent"/);
  assert.match(contract, /"memberSchedules"/);
  assert.match(contract, /"expectedUpdatedAt"/);
});

test("AI icon discovery forwards the retry delay for rate-limited callers", async () => {
  const route = await source("../app/api/ai/v1/icons/discover/route.ts");
  assert.match(route, /iconDiscoveryRetryAfter\(error\)/);
  assert.match(route, /"Retry-After": String\(retryAfterSeconds\)/);
});

test("subscription responses expose display, order, and archive state", async () => {
  const api = await source("../lib/ai-api.server.ts");
  for (const field of ["iconId", "cardAccent", "memberSchedules", "accent", "sortPosition", "isArchived"]) {
    assert.match(api, new RegExp(`${field}: item\\.${field}`));
  }
});

test("AI API documents independent member collection schedules", async () => {
  const [openapi, capabilities, guide, api, updateRoute] = await Promise.all([
    source("../app/api/ai/v1/openapi/route.ts"),
    source("../app/api/ai/v1/route.ts"),
    source("../app/settings/ai/ai-settings-panel.tsx"),
    source("../lib/ai-api.server.ts"),
    source("../app/api/ai/v1/subscriptions/[id]/route.ts"),
  ]);
  assert.match(openapi, /memberSchedules: \{ type: "array", maxItems: 20/);
  assert.match(openapi, /MemberScheduleWrite: \{/);
  assert.match(openapi, /MemberSchedule: \{/);
  assert.match(openapi, /amountMinor: \{ type: "integer", minimum: 0, maximum: 2147483647/);
  assert.match(openapi, /intervalUnit: \{ type: "string", enum: \["day", "week", "month", "year"\] \}/);
  assert.match(openapi, /reminderEnabled: \{ type: "boolean", default: false, description: "仅当 reminderEligible=true 时可开启/);
  assert.match(openapi, /anchorDay: \{ type: "integer", minimum: 1, maximum: 31, readOnly: true/);
  assert.match(openapi, /lastCollectedAt: \{ type: \["string", "null"\], format: "date-time", readOnly: true \}/);
  assert.match(openapi, /allOf: \[\{ if: \{ required: \["id"\] \}, then: \{ required: \["lastCollectedAt"\] \} \}\]/);
  assert.match(openapi, /SubscriptionPatch: \{.*properties: patchProperties.*required: \["expectedUpdatedAt"\]/);
  assert.match(openapi, /"409": \{ \$ref: "#\/components\/responses\/Conflict" \}/);
  assert.match(openapi, /传空数组清除，省略则保留/);
  assert.match(capabilities, /memberSchedules: \{\s+type: "array"/);
  assert.match(capabilities, /expectedUpdatedAt: \{ type: "ISO 8601 date-time"/);
  assert.match(guide, /memberSchedules 为每位成员分别记录应收金额/);
  assert.match(guide, /同一订阅同日应收合并发送/);
  assert.match(guide, /已有成员时，必须回传其 id 和最新 lastCollectedAt/);
  assert.match(api, /mode === "create" && input\.expectedUpdatedAt !== undefined/);
  assert.match(api, /error\.message === "订阅已变化，请刷新后重试"/);
  assert.match(api, /error\.message === "成员收款状态已变化，请刷新后重试"/);
  assert.match(updateRoute, /status: conflict \? 409 : 400/);
});

test("subscription ticket defaults to a native PNG and keeps JSON as an explicit option", async () => {
  const [route, renderer, openapi, guide] = await Promise.all([
    source("../app/api/ai/v1/ticket/route.ts"),
    source("../lib/subscription-ticket-image.server.ts"),
    source("../app/api/ai/v1/openapi/route.ts"),
    source("../app/settings/ai/ai-settings-panel.tsx"),
  ]);

  assert.match(route, /body\.format === undefined \? "png"/);
  assert.match(route, /"Content-Type": "image\/png"/);
  assert.match(route, /format === "png"/);
  assert.match(renderer, /\.png\(\{ compressionLevel: 9/);
  assert.match(renderer, /data:image\/png;base64/);
  assert.match(renderer, /resize\(88, 88/);
  assert.match(openapi, /"image\/png"/);
  assert.match(openapi, /enum: \["png", "json"\], default: "png"/);
  assert.match(guide, /返回的 PNG 作为图片直接交付/);
});

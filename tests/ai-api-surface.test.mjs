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
});

test("AI icon discovery forwards the retry delay for rate-limited callers", async () => {
  const route = await source("../app/api/ai/v1/icons/discover/route.ts");
  assert.match(route, /iconDiscoveryRetryAfter\(error\)/);
  assert.match(route, /"Retry-After": String\(retryAfterSeconds\)/);
});

test("subscription responses expose display, order, and archive state", async () => {
  const api = await source("../lib/ai-api.server.ts");
  for (const field of ["iconId", "cardAccent", "accent", "sortPosition", "isArchived"]) {
    assert.match(api, new RegExp(`${field}: item\\.${field}`));
  }
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

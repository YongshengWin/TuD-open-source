import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

const loaderSource = `
const modules = new Map([
  ["next/headers", "export async function headers() { return new Headers(); }"],
  ["next/server", "export const NextResponse = { json: (body, init) => Response.json(body, init) };"],
  ["../../../../lib/auth", \`
    export const auth = { api: { async getSession() {
      if (process.env.TUD_ICON_DISCOVERY_TEST_AUTH === "throw") throw new Error("private auth detail");
      if (process.env.TUD_ICON_DISCOVERY_TEST_AUTH === "missing") return null;
      return { user: { id: "user-1" } };
    } } };
  \`],
  ["../../../../lib/icon-discovery-service.server", \`
    class RateLimitError extends Error {
      constructor() { super("官网图标获取过于频繁，请 1 秒后再试"); this.retryAfterSeconds = 1; }
    }
    export async function discoverAndIndexWebsiteIcon() {
      if (process.env.TUD_ICON_DISCOVERY_TEST_SERVICE === "rate-limit") throw new RateLimitError();
      return { icon: { iconId: "website:example.com" }, created: false };
    }
    export function iconDiscoveryStatus(error) { return error instanceof RateLimitError ? 429 : 500; }
    export function iconDiscoveryRetryAfter(error) { return error instanceof RateLimitError ? error.retryAfterSeconds : null; }
  \`],
]);

export async function resolve(specifier, context, nextResolve) {
  const source = modules.get(specifier);
  if (source !== undefined) {
    return { url: \`data:text/javascript,\${encodeURIComponent(source)}\`, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
`;

register(`data:text/javascript,${encodeURIComponent(loaderSource)}`, import.meta.url);

const { POST } = await import("../app/api/icons/discover/route.ts?route-boundary-test");

function discoveryRequest(body = JSON.stringify({ website: "https://example.com" }), headers = {}) {
  return new Request("http://localhost/api/icons/discover", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

test("authentication failures stay inside the JSON error boundary", async () => {
  process.env.TUD_ICON_DISCOVERY_TEST_AUTH = "throw";
  delete process.env.TUD_ICON_DISCOVERY_TEST_SERVICE;
  try {
    const response = await POST(discoveryRequest());
    assert.equal(response.status, 500);
    assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
    const body = await response.json();
    assert.deepEqual(body, { error: "官网图标获取失败" });
    assert.doesNotMatch(JSON.stringify(body), /private auth detail/);
  } finally {
    delete process.env.TUD_ICON_DISCOVERY_TEST_AUTH;
  }
});

test("missing authentication remains an explicit JSON 401", async () => {
  process.env.TUD_ICON_DISCOVERY_TEST_AUTH = "missing";
  try {
    const response = await POST(discoveryRequest());
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Unauthorized" });
  } finally {
    delete process.env.TUD_ICON_DISCOVERY_TEST_AUTH;
  }
});

test("rate limiting returns 429 with a standards-compatible Retry-After header", async () => {
  process.env.TUD_ICON_DISCOVERY_TEST_AUTH = "ok";
  process.env.TUD_ICON_DISCOVERY_TEST_SERVICE = "rate-limit";
  try {
    const response = await POST(discoveryRequest());
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "1");
    assert.deepEqual(await response.json(), { error: "官网图标获取过于频繁，请 1 秒后再试" });
  } finally {
    delete process.env.TUD_ICON_DISCOVERY_TEST_AUTH;
    delete process.env.TUD_ICON_DISCOVERY_TEST_SERVICE;
  }
});

test("malformed and declared-oversized bodies return JSON client errors", async () => {
  process.env.TUD_ICON_DISCOVERY_TEST_AUTH = "ok";
  try {
    const malformed = await POST(discoveryRequest("{"));
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { error: "请求内容格式不正确" });

    const nonObject = await POST(discoveryRequest("null"));
    assert.equal(nonObject.status, 400);
    assert.deepEqual(await nonObject.json(), { error: "请求内容格式不正确" });

    const oversized = await POST(discoveryRequest("{}", { "content-length": "8193" }));
    assert.equal(oversized.status, 413);
    assert.deepEqual(await oversized.json(), { error: "请求内容过大" });
  } finally {
    delete process.env.TUD_ICON_DISCOVERY_TEST_AUTH;
  }
});

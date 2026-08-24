import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

const loaderSource = `
const modules = new Map([
  ["server-only", "export {};"],
  ["../db/icons", \`
    export async function createOrUpdateWebsiteDomainIcon() { return null; }
    export async function getIconById() { return null; }
    export function normalizeWebsiteIconDomain(value) { return String(value); }
  \`],
  ["./brand-catalog.server", "export async function findBrandByWebsite() { return null; }"],
  ["./website-icon-discovery.server", \`
    export class WebsiteIconDiscoveryError extends Error {
      constructor(code, message) { super(message); this.code = code; }
    }
    export async function discoverOfficialDomainIcon() { return null; }
    export async function discoverWebsiteIcon() { throw new Error("not implemented"); }
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

const {
  ICON_DISCOVERY_RATE_LIMIT,
  IconDiscoveryInputError,
  IconDiscoveryRateLimitError,
  createIconDiscoveryRateLimiter,
  iconDiscoveryRetryAfter,
  iconDiscoveryStatus,
} = await import("../lib/icon-discovery-service.server.ts?rate-limit-test");

test("website icon discovery uses a documented authenticated-user quota", () => {
  assert.deepEqual(ICON_DISCOVERY_RATE_LIMIT, {
    limit: 1,
    windowMs: 1_000,
  });
});

test("default quota permits one external discovery per user per second", () => {
  let now = 0;
  const limiter = createIconDiscoveryRateLimiter({ now: () => now });

  assert.deepEqual(limiter.consume("user-1"), { limit: 1, remaining: 0, resetAt: 1_000 });
  now = 999;
  assert.throws(
    () => limiter.consume("user-1"),
    (error) => error instanceof IconDiscoveryRateLimitError && error.retryAfterSeconds === 1,
  );
  now = 1_000;
  assert.deepEqual(limiter.consume("user-1"), { limit: 1, remaining: 0, resetAt: 2_000 });
});

test("sliding-window quota reports precise retry timing and does not extend a rejection", () => {
  let now = 0;
  const limiter = createIconDiscoveryRateLimiter({ limit: 2, windowMs: 10_000, now: () => now });

  assert.deepEqual(limiter.consume("user-1"), { limit: 2, remaining: 1, resetAt: 10_000 });
  now = 1_000;
  assert.deepEqual(limiter.consume("user-1"), { limit: 2, remaining: 0, resetAt: 10_000 });

  now = 2_500;
  assert.throws(
    () => limiter.consume("user-1"),
    (error) => {
      assert.ok(error instanceof IconDiscoveryRateLimitError);
      assert.equal(error.retryAfterSeconds, 8);
      assert.equal(error.message, "官网图标获取过于频繁，请 8 秒后再试");
      assert.equal(iconDiscoveryStatus(error), 429);
      assert.equal(iconDiscoveryRetryAfter(error), 8);
      return true;
    },
  );

  now = 10_000;
  assert.deepEqual(limiter.consume("user-1"), { limit: 2, remaining: 0, resetAt: 11_000 });
});

test("sliding-window quotas are isolated per authenticated user", () => {
  const limiter = createIconDiscoveryRateLimiter({ limit: 1, windowMs: 60_000, now: () => 5_000 });

  assert.equal(limiter.consume("user-1").remaining, 0);
  assert.equal(limiter.consume("user-2").remaining, 0);
  assert.throws(() => limiter.consume("user-1"), IconDiscoveryRateLimitError);
});

test("only expected discovery failures are exposed as client errors", () => {
  assert.equal(iconDiscoveryStatus(new IconDiscoveryInputError("输入错误")), 400);
  assert.equal(iconDiscoveryStatus(new IconDiscoveryRateLimitError(1)), 429);
  assert.equal(iconDiscoveryStatus(new Error("数据库内部错误")), 500);
  assert.equal(iconDiscoveryRetryAfter(new Error("普通错误")), null);
});

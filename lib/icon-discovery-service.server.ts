import "server-only";
import { createOrUpdateWebsiteDomainIcon, getIconById, normalizeWebsiteIconDomain } from "../db/icons";
import { findBrandByWebsite } from "./brand-catalog.server";
import type { BrandChoice } from "./brand-options";
import { discoverOfficialDomainIcon, discoverWebsiteIcon, WebsiteIconDiscoveryError } from "./website-icon-discovery.server";

export const ICON_DISCOVERY_RATE_LIMIT = {
  limit: 1,
  windowMs: 1_000,
} as const;

type IconDiscoveryRateLimiterOptions = {
  limit?: number;
  windowMs?: number;
  now?: () => number;
  attempts?: Map<string, number[]>;
};

export class IconDiscoveryRateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(`官网图标获取过于频繁，请 ${retryAfterSeconds} 秒后再试`);
    this.name = "IconDiscoveryRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class IconDiscoveryInputError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "IconDiscoveryInputError";
  }
}

export function createIconDiscoveryRateLimiter(options: IconDiscoveryRateLimiterOptions = {}) {
  const limit = options.limit ?? ICON_DISCOVERY_RATE_LIMIT.limit;
  const windowMs = options.windowMs ?? ICON_DISCOVERY_RATE_LIMIT.windowMs;
  const now = options.now ?? Date.now;
  const attemptStore = options.attempts ?? new Map<string, number[]>();
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("官网图标限流配额配置无效");
  if (!Number.isSafeInteger(windowMs) || windowMs < 1) throw new Error("官网图标限流时间窗口配置无效");

  return {
    consume(userId: string) {
      const timestamp = now();
      if (!Number.isFinite(timestamp)) throw new Error("官网图标限流时钟无效");
      const cutoff = timestamp - windowMs;
      const recent = (attemptStore.get(userId) ?? []).filter((attempt) => attempt > cutoff);
      if (recent.length >= limit) {
        attemptStore.set(userId, recent);
        const retryAfterSeconds = Math.max(1, Math.ceil((recent[0] + windowMs - timestamp) / 1_000));
        throw new IconDiscoveryRateLimitError(retryAfterSeconds);
      }
      recent.push(timestamp);
      attemptStore.set(userId, recent);
      return {
        limit,
        remaining: limit - recent.length,
        resetAt: recent[0] + windowMs,
      };
    },
  };
}

const globalForDiscovery = globalThis as unknown as { tudIconDiscoveryAttempts?: Map<string, number[]> };
const attempts = globalForDiscovery.tudIconDiscoveryAttempts ?? new Map<string, number[]>();
globalForDiscovery.tudIconDiscoveryAttempts = attempts;
const discoveryRateLimiter = createIconDiscoveryRateLimiter({ attempts });

function assertDiscoveryRate(userId: string) {
  discoveryRateLimiter.consume(userId);
}

export function iconDiscoveryStatus(error: unknown) {
  if (error instanceof IconDiscoveryRateLimitError) return 429;
  if (error instanceof IconDiscoveryInputError) return 400;
  if (!(error instanceof WebsiteIconDiscoveryError)) return 500;
  if (error.code === "TIMEOUT") return 504;
  if (error.code === "HTTP_ERROR" || error.code === "DNS_FAILED") return 502;
  if (error.code === "NO_ICON") return 422;
  return 400;
}

export function iconDiscoveryRetryAfter(error: unknown) {
  return error instanceof IconDiscoveryRateLimitError ? error.retryAfterSeconds : null;
}

function indexedIcon(catalog: {
  id: string;
  displayName: string;
  accent: string | null;
  license: string | null;
  websiteDomain: string | null;
}): BrandChoice {
  return {
    iconId: catalog.id,
    iconKey: "fallback",
    title: catalog.displayName,
    accent: catalog.accent ?? "blue",
    source: "website" as const,
    sourceLabel: "官方网站",
    license: catalog.license ?? undefined,
    domain: catalog.websiteDomain,
  };
}

export async function discoverAndIndexWebsiteIcon(userId: string, website: unknown) {
  if (typeof website !== "string") throw new IconDiscoveryInputError("请填写服务官网");
  let requestedDomain: string;
  try {
    requestedDomain = normalizeWebsiteIconDomain(website);
  } catch (error) {
    throw new IconDiscoveryInputError(error instanceof Error ? error.message : "官网地址格式不正确", { cause: error });
  }
  const catalogIcon = await findBrandByWebsite(requestedDomain);
  if (catalogIcon) return { icon: catalogIcon, created: false };
  const existing = await getIconById(`website:${requestedDomain}`);
  if (existing?.catalog.isActive && existing.asset) return { icon: indexedIcon(existing.catalog), created: false };
  assertDiscoveryRate(userId);

  let discovered = null;
  try {
    discovered = await discoverOfficialDomainIcon(website);
  } catch {
    // Fall back to direct, SSRF-safe website discovery.
  }
  const discoveryMethod = discovered ? "tud-official-domain-map" : "tud-website-discovery";
  discovered ??= await discoverWebsiteIcon(website);
  const now = new Date().toISOString();
  const record = await createOrUpdateWebsiteDomainIcon({
    website: discovered.website,
    displayName: discovered.title || discovered.domain,
    aliases: [],
    priority: 0,
    mimeType: discovered.mimeType,
    license: "Website-provided artwork",
    sourcePage: discovered.website,
    sourceRevision: now,
    assetUrl: discovered.sourceUrl,
    accent: "blue",
    metadata: {
      discoveredAt: now,
      discoveredBy: discoveryMethod,
      ...(discovered.upstreamSha256 ? { upstreamSha256: discovered.upstreamSha256 } : {}),
    },
    asset: {
      contentBase64: discovered.bytes.toString("base64"),
      mimeType: discovered.mimeType,
      metadata: {
        sourceUrl: discovered.sourceUrl,
        fetchedAt: now,
        discoveredBy: discoveryMethod,
        ...(discovered.upstreamSha256 ? { upstreamSha256: discovered.upstreamSha256 } : {}),
      },
    },
  });
  if (!record?.catalog) throw new Error("官网图标写入失败");
  return { icon: indexedIcon(record.catalog), created: true };
}

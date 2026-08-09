import "server-only";
import { createOrUpdateWebsiteDomainIcon, getIconById, normalizeWebsiteIconDomain } from "../db/icons";
import type { BrandChoice } from "./brand-options";
import { discoverOfficialDomainIcon, discoverWebsiteIcon, WebsiteIconDiscoveryError } from "./website-icon-discovery.server";

const DISCOVERY_WINDOW_MS = 10 * 60 * 1_000;
const DISCOVERY_LIMIT = 8;
const globalForDiscovery = globalThis as unknown as { tudIconDiscoveryAttempts?: Map<string, number[]> };
const attempts = globalForDiscovery.tudIconDiscoveryAttempts ?? new Map<string, number[]>();
globalForDiscovery.tudIconDiscoveryAttempts = attempts;

function assertDiscoveryRate(userId: string) {
  const now = Date.now();
  const recent = (attempts.get(userId) ?? []).filter((timestamp) => now - timestamp < DISCOVERY_WINDOW_MS);
  if (recent.length >= DISCOVERY_LIMIT) throw new Error("官网图标获取过于频繁，请稍后再试");
  recent.push(now);
  attempts.set(userId, recent);
}

export function iconDiscoveryStatus(error: unknown) {
  if (!(error instanceof WebsiteIconDiscoveryError)) return 400;
  if (error.code === "TIMEOUT") return 504;
  if (error.code === "HTTP_ERROR" || error.code === "DNS_FAILED") return 502;
  if (error.code === "NO_ICON") return 422;
  return 400;
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
  if (typeof website !== "string") throw new Error("请填写服务官网");
  const requestedDomain = normalizeWebsiteIconDomain(website);
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

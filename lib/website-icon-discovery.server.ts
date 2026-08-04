import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import http, { type IncomingHttpHeaders } from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { validateUntrustedSvgIcon } from "./icon-asset-loader.server.ts";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_USER_AGENT = "TuD-Icon-Discovery/1.0";

export const WEBSITE_ICON_DISCOVERY_DEFAULTS = {
  requestTimeoutMs: 5_000,
  htmlMaxBytes: 1_000_000,
  manifestMaxBytes: 256_000,
  imageMaxBytes: 2_000_000,
  maxRedirects: 3,
  maxCandidates: 24,
} as const;

export type WebsiteIconMimeType = "image/png" | "image/jpeg" | "image/webp" | "image/x-icon" | "image/svg+xml";

export type WebsiteIconAddress = {
  address: string;
  family: 4 | 6;
};

export type WebsiteIconResolver = (hostname: string) => Promise<readonly WebsiteIconAddress[]>;

export type WebsiteIconRequest = {
  url: URL;
  address: string;
  family: 4 | 6;
  timeoutMs: number;
  maxBytes: number;
  headers: Readonly<Record<string, string>>;
};

export type WebsiteIconResponse = {
  status: number;
  headers: Readonly<Record<string, string | undefined>>;
  body: Buffer;
};

export type WebsiteIconRequester = (request: WebsiteIconRequest) => Promise<WebsiteIconResponse>;

export type WebsiteIconDiscoveryOptions = {
  resolver?: WebsiteIconResolver;
  requester?: WebsiteIconRequester;
  requestTimeoutMs?: number;
  htmlMaxBytes?: number;
  manifestMaxBytes?: number;
  imageMaxBytes?: number;
  maxRedirects?: number;
  maxCandidates?: number;
  userAgent?: string;
};

export type DiscoveredWebsiteIcon = {
  website: string;
  domain: string;
  sourceUrl: string;
  mimeType: WebsiteIconMimeType;
  bytes: Buffer;
  title: string;
  upstreamSha256?: string;
};

export type OfficialDomainIconDiscovery = DiscoveredWebsiteIcon & {
  mappedDomain: string;
};

export type WebsiteIconDiscoveryErrorCode =
  | "INVALID_URL"
  | "UNSAFE_URL"
  | "DNS_FAILED"
  | "TIMEOUT"
  | "TOO_LARGE"
  | "TOO_MANY_REDIRECTS"
  | "HTTP_ERROR"
  | "NO_ICON";

export class WebsiteIconDiscoveryError extends Error {
  readonly code: WebsiteIconDiscoveryErrorCode;

  constructor(code: WebsiteIconDiscoveryErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WebsiteIconDiscoveryError";
    this.code = code;
  }
}

type ResolvedRequestOptions = Required<
  Pick<
    WebsiteIconDiscoveryOptions,
    | "requestTimeoutMs"
    | "htmlMaxBytes"
    | "manifestMaxBytes"
    | "imageMaxBytes"
    | "maxRedirects"
    | "maxCandidates"
    | "userAgent"
  >
> & {
  resolver: WebsiteIconResolver;
  requester: WebsiteIconRequester;
};

type FetchedResource = WebsiteIconResponse & {
  url: URL;
};

type CandidateKind = "apple" | "manifest" | "icon" | "fallback-apple" | "fallback-favicon";

type IconCandidate = {
  url: URL;
  kind: CandidateKind;
  size: number;
  order: number;
  purposeAny: boolean;
};

type ParsedCidr = {
  bytes: Uint8Array;
  prefix: number;
};

type OfficialDomainIconDefinition = {
  domain: string;
  displayName: string;
  assetUrl: string;
  cropViewBox?: string;
  allowEmbeddedPngImages?: boolean;
};

const OFFICIAL_DOMAIN_ICON_DEFINITIONS: readonly OfficialDomainIconDefinition[] = [
  {
    domain: "dmit.io",
    displayName: "DMIT",
    assetUrl: "https://www.dmit.io/templates/dmit_theme_2020/dmit/assets/images/dmit_logo_with_text.svg",
    cropViewBox: "0 0 2134 2134",
    allowEmbeddedPngImages: true,
  },
  {
    domain: "vmiss.com",
    displayName: "VMISS",
    assetUrl: "https://www.vmiss.com/wp-content/uploads/2023/11/favicon.ico",
  },
];

const BLOCKED_IPV4_CIDRS = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.31.196.0/24",
  "192.52.193.0/24",
  "192.88.99.0/24",
  "192.168.0.0/16",
  "192.175.48.0/24",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
] as const;

const BLOCKED_IPV6_CIDRS = [
  "::/128",
  "::1/128",
  "64:ff9b::/96",
  "64:ff9b:1::/48",
  "100::/64",
  "2001::/23",
  "2001:db8::/32",
  "2002::/16",
  "3fff::/20",
  "fc00::/7",
  "fe80::/10",
  "fec0::/10",
  "ff00::/8",
] as const;

function parseIPv4(address: string): Uint8Array | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const bytes = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return Number.NaN;
    return Number(part);
  });
  if (bytes.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return Uint8Array.from(bytes);
}

function parseIPv6(address: string): Uint8Array | null {
  if (address.includes("%")) return null;
  let normalized = address.toLowerCase();

  if (normalized.includes(".")) {
    const lastColon = normalized.lastIndexOf(":");
    if (lastColon < 0) return null;
    const ipv4 = parseIPv4(normalized.slice(lastColon + 1));
    if (!ipv4) return null;
    const first = ((ipv4[0] ?? 0) << 8) | (ipv4[1] ?? 0);
    const second = ((ipv4[2] ?? 0) << 8) | (ipv4[3] ?? 0);
    normalized = `${normalized.slice(0, lastColon)}:${first.toString(16)}:${second.toString(16)}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (left.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  if (right.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;

  const missing = 8 - left.length - right.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8) return null;

  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => {
    const value = Number.parseInt(group, 16);
    bytes[index * 2] = value >> 8;
    bytes[index * 2 + 1] = value & 0xff;
  });
  return bytes;
}

function parseCidr(value: string): ParsedCidr {
  const [address, rawPrefix] = value.split("/");
  const bytes = address?.includes(":") ? parseIPv6(address) : parseIPv4(address ?? "");
  const prefix = Number(rawPrefix);
  if (!bytes || !Number.isInteger(prefix) || prefix < 0 || prefix > bytes.length * 8) {
    throw new Error(`Invalid internal CIDR: ${value}`);
  }
  return { bytes, prefix };
}

const BLOCKED_IPV4 = BLOCKED_IPV4_CIDRS.map(parseCidr);
const BLOCKED_IPV6 = BLOCKED_IPV6_CIDRS.map(parseCidr);
const PROXY_FAKE_IPV4 = parseCidr("198.18.0.0/15");
const GLOBAL_IPV6 = parseCidr("2000::/3");
const IPV4_MAPPED_IPV6 = parseCidr("::ffff:0:0/96");

function matchesCidr(address: Uint8Array, cidr: ParsedCidr) {
  if (address.length !== cidr.bytes.length) return false;
  const fullBytes = Math.floor(cidr.prefix / 8);
  const remainingBits = cidr.prefix % 8;
  for (let index = 0; index < fullBytes; index += 1) {
    if (address[index] !== cidr.bytes[index]) return false;
  }
  if (remainingBits === 0) return true;
  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return ((address[fullBytes] ?? 0) & mask) === ((cidr.bytes[fullBytes] ?? 0) & mask);
}

export function isPublicWebsiteAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const bytes = parseIPv4(address);
    return Boolean(bytes && !BLOCKED_IPV4.some((cidr) => matchesCidr(bytes, cidr)));
  }
  if (family !== 6) return false;
  const bytes = parseIPv6(address);
  if (!bytes) return false;

  if (matchesCidr(bytes, IPV4_MAPPED_IPV6)) {
    return isPublicWebsiteAddress(Array.from(bytes.slice(12)).join("."));
  }

  return matchesCidr(bytes, GLOBAL_IPV6) && !BLOCKED_IPV6.some((cidr) => matchesCidr(bytes, cidr));
}

function normalizeUrl(value: string | URL): URL {
  let url: URL;
  try {
    if (value instanceof URL) {
      url = new URL(value);
    } else {
      const raw = value.trim();
      const hasExplicitScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw);
      const looksLikeBareHostWithPort = /^(?:localhost|(?:[a-z0-9-]+\.)+[a-z0-9-]+|\d{1,3}(?:\.\d{1,3}){3}):\d+(?:[/?#]|$)/i.test(raw);
      url = new URL(!hasExplicitScheme || looksLikeBareHostWithPort ? `https://${raw}` : raw);
    }
  } catch (cause) {
    throw new WebsiteIconDiscoveryError("INVALID_URL", "官网地址格式不正确", { cause });
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WebsiteIconDiscoveryError("INVALID_URL", "官网地址必须使用 http 或 https");
  }
  if (url.username || url.password) {
    throw new WebsiteIconDiscoveryError("UNSAFE_URL", "官网地址不能包含用户名或密码");
  }
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new WebsiteIconDiscoveryError("UNSAFE_URL", "官网地址只能使用 80 或 443 端口");
  }
  if (!url.hostname) {
    throw new WebsiteIconDiscoveryError("INVALID_URL", "官网地址缺少域名");
  }

  if (url.hostname.endsWith(".")) url.hostname = url.hostname.slice(0, -1);
  url.hash = "";
  return url;
}

function hostnameMatchesDomain(hostname: string, domain: string) {
  const normalizedHostname = hostname.toLowerCase().replace(/\.$/, "");
  const normalizedDomain = domain.toLowerCase().replace(/\.$/, "");
  return normalizedHostname === normalizedDomain || normalizedHostname.endsWith(`.${normalizedDomain}`);
}

function findOfficialDomainIcon(url: URL) {
  const hostname = canonicalHostname(url);
  return OFFICIAL_DOMAIN_ICON_DEFINITIONS.find((definition) => hostnameMatchesDomain(hostname, definition.domain)) ?? null;
}

function prepareOfficialSvg(bytes: Buffer, definition: OfficialDomainIconDefinition) {
  let svg: string;
  try {
    svg = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch (cause) {
    throw new WebsiteIconDiscoveryError("NO_ICON", "官方图标不是有效的 UTF-8 SVG", { cause });
  }
  if (/<!entity\b|<!doctype\b[^>]*\[/i.test(svg)) {
    throw new WebsiteIconDiscoveryError("NO_ICON", "官方图标包含不安全的 XML 声明");
  }
  svg = svg
    .replace(/^\s*<\?xml\b[\s\S]*?\?>\s*/i, "")
    .replace(/^\s*<!doctype\s+svg\b(?:[^>"']|"[^"]*"|'[^']*')*>\s*/i, "");

  const root = svg.match(/<svg\b[^>]*>/i);
  if (!root?.[0] || root.index == null) {
    throw new WebsiteIconDiscoveryError("NO_ICON", "官方图标缺少 SVG 根元素");
  }
  const viewBoxes = [...root[0].matchAll(/\sviewbox\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi)];
  if (viewBoxes.length > 1) {
    throw new WebsiteIconDiscoveryError("NO_ICON", "官方图标包含重复的 viewBox");
  }
  if (!definition.cropViewBox) {
    try {
      return validateUntrustedSvgIcon(Buffer.from(svg, "utf8"), {
        allowEmbeddedPngImages: definition.allowEmbeddedPngImages,
      });
    } catch (cause) {
      throw new WebsiteIconDiscoveryError("NO_ICON", "官方图标没有通过安全校验", { cause });
    }
  }
  let transformedRoot = viewBoxes.length === 1
    ? root[0].replace(viewBoxes[0]?.[0] ?? "", ` viewBox="${definition.cropViewBox}"`)
    : root[0].replace(/<svg\b/i, `<svg viewBox="${definition.cropViewBox}"`);
  const overflowAttributes = [...transformedRoot.matchAll(/\soverflow\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi)];
  if (overflowAttributes.length > 1) {
    throw new WebsiteIconDiscoveryError("NO_ICON", "官方图标包含重复的 overflow 属性");
  }
  transformedRoot = overflowAttributes.length === 1
    ? transformedRoot.replace(overflowAttributes[0]?.[0] ?? "", ' overflow="hidden"')
    : transformedRoot.replace(/<svg\b/i, '<svg overflow="hidden"');
  svg = `${svg.slice(0, root.index)}${transformedRoot}${svg.slice(root.index + root[0].length)}`;

  try {
    return validateUntrustedSvgIcon(Buffer.from(svg, "utf8"), {
      allowEmbeddedPngImages: definition.allowEmbeddedPngImages,
    });
  } catch (cause) {
    throw new WebsiteIconDiscoveryError("NO_ICON", "官方图标没有通过安全校验", { cause });
  }
}

function canonicalHostname(url: URL) {
  const hostname = url.hostname.toLowerCase();
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new WebsiteIconDiscoveryError("TIMEOUT", `${label}超时`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function resolveWithPublicDoh(hostname: string): Promise<readonly WebsiteIconAddress[]> {
  const endpoint = new URL("https://cloudflare-dns.com/dns-query");
  endpoint.searchParams.set("name", hostname);
  endpoint.searchParams.set("type", "A");
  const response = await fetch(endpoint, {
    headers: { accept: "application/dns-json", "user-agent": DEFAULT_USER_AGENT },
    redirect: "error",
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) throw new Error(`DoH returned HTTP ${response.status}`);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > 64 * 1024) throw new Error("DoH response is too large");
  const body = await response.json() as { Status?: number; Answer?: Array<{ type?: number; data?: string }> };
  if (body.Status !== 0) throw new Error(`DoH returned status ${body.Status}`);
  return (body.Answer ?? []).flatMap((answer) => {
    const family = answer.type === 1 ? 4 : answer.type === 28 ? 6 : 0;
    return family && answer.data && isIP(answer.data) === family
      ? [{ address: answer.data, family } as WebsiteIconAddress]
      : [];
  });
}

async function defaultResolver(hostname: string): Promise<readonly WebsiteIconAddress[]> {
  try {
    const records = await dnsLookup(hostname, { all: true, verbatim: true });
    const normalized = records.flatMap((record) => {
      const family = isIP(record.address);
      return family === 4 || family === 6
        ? [{ address: record.address, family } satisfies WebsiteIconAddress]
        : [];
    });
    const proxyFakeIpOnly = normalized.length > 0 && normalized.every((record) => {
      const bytes = record.family === 4 ? parseIPv4(record.address) : null;
      return Boolean(bytes && matchesCidr(bytes, PROXY_FAKE_IPV4));
    });
    // Clash and similar local proxies intentionally map public domains into
    // 198.18.0.0/15. Keep that range blocked, but recover the real public A
    // records through one fixed HTTPS resolver instead of weakening SSRF rules.
    return proxyFakeIpOnly ? await resolveWithPublicDoh(hostname) : normalized;
  } catch (cause) {
    throw new WebsiteIconDiscoveryError("DNS_FAILED", "无法解析官网域名", { cause });
  }
}

function headersToRecord(headers: IncomingHttpHeaders): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), Array.isArray(value) ? value.join(", ") : value]),
  );
}

async function defaultRequester(input: WebsiteIconRequest): Promise<WebsiteIconResponse> {
  const transport = input.url.protocol === "https:" ? https : http;
  const lookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address: input.address, family: input.family }], input.family);
      return;
    }
    callback(null, input.address, input.family);
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      callback();
    };
    const request = transport.request(input.url, {
      method: "GET",
      headers: input.headers,
      lookup,
    });
    const timer = setTimeout(() => {
      request.destroy(new WebsiteIconDiscoveryError("TIMEOUT", "获取官网资源超时"));
    }, input.timeoutMs);

    request.on("response", (response) => {
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer | string) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += bytes.length;
        if (total > input.maxBytes) {
          response.destroy(new WebsiteIconDiscoveryError("TOO_LARGE", "官网资源超过大小限制"));
          return;
        }
        chunks.push(bytes);
      });
      response.on("end", () => {
        clearTimeout(timer);
        finish(() => resolve({
          status: response.statusCode ?? 0,
          headers: headersToRecord(response.headers),
          body: Buffer.concat(chunks, total),
        }));
      });
      response.on("error", (error) => {
        clearTimeout(timer);
        finish(() => reject(error));
      });
    });
    request.on("error", (error) => {
      clearTimeout(timer);
      finish(() => reject(error));
    });
    request.end();
  });
}

async function resolveSafeAddress(url: URL, options: ResolvedRequestOptions): Promise<WebsiteIconAddress> {
  const hostname = canonicalHostname(url);
  const literalFamily = isIP(hostname);
  const records = literalFamily === 4 || literalFamily === 6
    ? [{ address: hostname, family: literalFamily }]
    : await withTimeout(options.resolver(hostname), options.requestTimeoutMs, "域名解析");

  if (records.length === 0) {
    throw new WebsiteIconDiscoveryError("DNS_FAILED", "官网域名没有可用地址");
  }
  for (const record of records) {
    const actualFamily = isIP(record.address);
    if ((actualFamily !== 4 && actualFamily !== 6) || actualFamily !== record.family) {
      throw new WebsiteIconDiscoveryError("DNS_FAILED", "官网域名返回了无效地址");
    }
    if (!isPublicWebsiteAddress(record.address)) {
      throw new WebsiteIconDiscoveryError("UNSAFE_URL", "官网地址解析到了不可访问的内部地址");
    }
  }
  return records[0] as WebsiteIconAddress;
}

function getHeader(headers: Readonly<Record<string, string | undefined>>, name: string) {
  const target = name.toLowerCase();
  const direct = headers[target];
  if (direct !== undefined) return direct;
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === target);
  return entry?.[1];
}

async function fetchWithRedirects(
  initialUrl: URL,
  maxBytes: number,
  options: ResolvedRequestOptions,
): Promise<FetchedResource> {
  let url = normalizeUrl(initialUrl);
  for (let redirectCount = 0; ; redirectCount += 1) {
    const pinnedAddress = await resolveSafeAddress(url, options);
    const response = await withTimeout(options.requester({
      url: new URL(url),
      address: pinnedAddress.address,
      family: pinnedAddress.family,
      timeoutMs: options.requestTimeoutMs,
      maxBytes,
      headers: {
        accept: "*/*",
        "accept-encoding": "identity",
        "user-agent": options.userAgent,
      },
    }), options.requestTimeoutMs, "获取官网资源");

    if (response.body.length > maxBytes) {
      throw new WebsiteIconDiscoveryError("TOO_LARGE", "官网资源超过大小限制");
    }
    if (!REDIRECT_STATUSES.has(response.status)) return { ...response, url };
    if (redirectCount >= options.maxRedirects) {
      throw new WebsiteIconDiscoveryError("TOO_MANY_REDIRECTS", "官网重定向次数过多");
    }
    const location = getHeader(response.headers, "location");
    if (!location) {
      throw new WebsiteIconDiscoveryError("HTTP_ERROR", "官网返回了无目标地址的重定向");
    }
    try {
      url = normalizeUrl(new URL(location, url));
    } catch (cause) {
      if (cause instanceof WebsiteIconDiscoveryError) throw cause;
      throw new WebsiteIconDiscoveryError("INVALID_URL", "官网重定向地址无效", { cause });
    }
  }
}

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(tag)) !== null) {
    const name = match[1]?.toLowerCase();
    if (!name || name === "link") continue;
    attributes[name] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function extractTitle(html: string, fallback: string) {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  const title = match ? decodeHtml(match[1] ?? "").replace(/\s+/g, " ").trim().slice(0, 200) : "";
  return title || fallback;
}

function parseSizeScore(value: string | undefined) {
  if (!value) return 0;
  let largest = 0;
  for (const token of value.toLowerCase().split(/\s+/)) {
    if (token === "any") {
      largest = Math.max(largest, 4096);
      continue;
    }
    const match = token.match(/^(\d{1,5})x(\d{1,5})$/);
    if (!match) continue;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (width > 0 && height > 0) largest = Math.max(largest, Math.min(width, height));
  }
  return largest;
}

function candidateUrl(value: string | undefined, base: URL): URL | null {
  if (!value) return null;
  try {
    const url = new URL(decodeHtml(value.trim()), base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

function parseHtmlLinks(html: string, pageUrl: URL) {
  const icons: IconCandidate[] = [];
  const manifests: URL[] = [];
  const tags = html.match(/<link\b[^>]*>/gi) ?? [];
  tags.forEach((tag, order) => {
    const attributes = parseAttributes(tag);
    const rels = new Set((attributes.rel ?? "").toLowerCase().split(/\s+/).filter(Boolean));
    const url = candidateUrl(attributes.href, pageUrl);
    if (!url) return;
    if (rels.has("manifest")) {
      if (manifests.length < 2) manifests.push(url);
      return;
    }
    const isApple = rels.has("apple-touch-icon") || rels.has("apple-touch-icon-precomposed");
    const isIcon = rels.has("icon") || (rels.has("shortcut") && rels.has("icon"));
    if (!isApple && !isIcon) return;
    icons.push({
      url,
      kind: isApple ? "apple" : "icon",
      size: parseSizeScore(attributes.sizes),
      order,
      purposeAny: true,
    });
  });
  return { icons, manifests };
}

function parseManifestIcons(body: Buffer, manifestUrl: URL, startOrder: number): IconCandidate[] {
  let manifest: unknown;
  try {
    manifest = JSON.parse(body.toString("utf8"));
  } catch {
    return [];
  }
  if (!manifest || typeof manifest !== "object" || !("icons" in manifest) || !Array.isArray(manifest.icons)) return [];

  return manifest.icons.slice(0, 32).flatMap((value, index): IconCandidate[] => {
    if (!value || typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    const url = candidateUrl(typeof record.src === "string" ? record.src : undefined, manifestUrl);
    if (!url) return [];
    const purpose = typeof record.purpose === "string" ? record.purpose.toLowerCase().split(/\s+/) : ["any"];
    return [{
      url,
      kind: "manifest",
      size: parseSizeScore(typeof record.sizes === "string" ? record.sizes : undefined),
      order: startOrder + index,
      purposeAny: purpose.includes("any") || !record.purpose,
    }];
  });
}

const KIND_PRIORITY: Record<CandidateKind, number> = {
  apple: 5,
  manifest: 4,
  icon: 3,
  "fallback-apple": 2,
  "fallback-favicon": 1,
};

function rankCandidates(candidates: IconCandidate[], limit: number) {
  const unique = new Map<string, IconCandidate>();
  for (const candidate of candidates) {
    const key = candidate.url.toString();
    const current = unique.get(key);
    if (!current || KIND_PRIORITY[candidate.kind] > KIND_PRIORITY[current.kind]) unique.set(key, candidate);
  }
  return [...unique.values()]
    .sort((left, right) =>
      KIND_PRIORITY[right.kind] - KIND_PRIORITY[left.kind]
      || Number(right.purposeAny) - Number(left.purposeAny)
      || right.size - left.size
      || left.order - right.order,
    )
    .slice(0, limit);
}

export function detectWebsiteIconMimeType(bytes: Uint8Array): WebsiteIconMimeType | null {
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 12
    && Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF"
    && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
  ) return "image/webp";
  if (
    bytes.length >= 6
    && bytes[0] === 0
    && bytes[1] === 0
    && bytes[2] === 1
    && bytes[3] === 0
    && ((bytes[4] ?? 0) | ((bytes[5] ?? 0) << 8)) > 0
  ) return "image/x-icon";
  return null;
}

async function tryFetchIcon(candidate: IconCandidate, options: ResolvedRequestOptions) {
  try {
    const response = await fetchWithRedirects(candidate.url, options.imageMaxBytes, options);
    if (response.status < 200 || response.status >= 300) return null;
    const rasterMimeType = detectWebsiteIconMimeType(response.body);
    if (rasterMimeType) return { response, mimeType: rasterMimeType, bytes: response.body };
    try {
      const validated = validateUntrustedSvgIcon(response.body);
      return { response, mimeType: validated.mimeType, bytes: validated.bytes };
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

function resolveOptions(options: WebsiteIconDiscoveryOptions): ResolvedRequestOptions {
  const resolved = {
    requestTimeoutMs: options.requestTimeoutMs ?? WEBSITE_ICON_DISCOVERY_DEFAULTS.requestTimeoutMs,
    htmlMaxBytes: options.htmlMaxBytes ?? WEBSITE_ICON_DISCOVERY_DEFAULTS.htmlMaxBytes,
    manifestMaxBytes: options.manifestMaxBytes ?? WEBSITE_ICON_DISCOVERY_DEFAULTS.manifestMaxBytes,
    imageMaxBytes: options.imageMaxBytes ?? WEBSITE_ICON_DISCOVERY_DEFAULTS.imageMaxBytes,
    maxRedirects: options.maxRedirects ?? WEBSITE_ICON_DISCOVERY_DEFAULTS.maxRedirects,
    maxCandidates: options.maxCandidates ?? WEBSITE_ICON_DISCOVERY_DEFAULTS.maxCandidates,
    userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
  };
  for (const [name, value] of Object.entries({
    requestTimeoutMs: resolved.requestTimeoutMs,
    htmlMaxBytes: resolved.htmlMaxBytes,
    manifestMaxBytes: resolved.manifestMaxBytes,
    imageMaxBytes: resolved.imageMaxBytes,
    maxCandidates: resolved.maxCandidates,
  })) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new WebsiteIconDiscoveryError("INVALID_URL", `${name} 配置无效`);
    }
  }
  if (!Number.isSafeInteger(resolved.maxRedirects) || resolved.maxRedirects < 0 || resolved.maxRedirects > 3) {
    throw new WebsiteIconDiscoveryError("INVALID_URL", "maxRedirects 配置无效");
  }
  return {
    resolver: options.resolver ?? defaultResolver,
    requester: options.requester ?? defaultRequester,
    requestTimeoutMs: resolved.requestTimeoutMs,
    htmlMaxBytes: resolved.htmlMaxBytes,
    manifestMaxBytes: resolved.manifestMaxBytes,
    imageMaxBytes: resolved.imageMaxBytes,
    maxRedirects: resolved.maxRedirects,
    maxCandidates: resolved.maxCandidates,
    userAgent: resolved.userAgent,
  };
}

export async function discoverWebsiteIcon(
  website: string | URL,
  options: WebsiteIconDiscoveryOptions = {},
): Promise<DiscoveredWebsiteIcon> {
  const resolvedOptions = resolveOptions(options);
  const pageResponse = await fetchWithRedirects(normalizeUrl(website), resolvedOptions.htmlMaxBytes, resolvedOptions);
  if (pageResponse.status < 200 || pageResponse.status >= 300) {
    throw new WebsiteIconDiscoveryError("HTTP_ERROR", `官网返回了 HTTP ${pageResponse.status}`);
  }

  const html = pageResponse.body.toString("utf8");
  const domain = canonicalHostname(pageResponse.url);
  const title = extractTitle(html, domain);
  const parsed = parseHtmlLinks(html, pageResponse.url);
  const manifestCandidates: IconCandidate[] = [];

  for (const manifestUrl of parsed.manifests) {
    try {
      const response = await fetchWithRedirects(manifestUrl, resolvedOptions.manifestMaxBytes, resolvedOptions);
      if (response.status >= 200 && response.status < 300) {
        manifestCandidates.push(...parseManifestIcons(response.body, response.url, parsed.icons.length + manifestCandidates.length));
      }
    } catch {
      // A broken or unsafe manifest must not prevent trying declared and fallback icons.
    }
  }

  const fallbackOrigin = pageResponse.url.origin;
  const rankedCandidates = rankCandidates([
    ...parsed.icons,
    ...manifestCandidates,
  ], resolvedOptions.maxCandidates);
  const candidates = rankCandidates([
    ...rankedCandidates,
    {
      url: new URL("/apple-touch-icon.png", fallbackOrigin),
      kind: "fallback-apple",
      size: 180,
      order: Number.MAX_SAFE_INTEGER - 1,
      purposeAny: true,
    },
    {
      url: new URL("/favicon.ico", fallbackOrigin),
      kind: "fallback-favicon",
      size: 32,
      order: Number.MAX_SAFE_INTEGER,
      purposeAny: true,
    },
  ], rankedCandidates.length + 2);

  for (const candidate of candidates) {
    const icon = await tryFetchIcon(candidate, resolvedOptions);
    if (!icon) continue;
    return {
      website: `${pageResponse.url.origin}/`,
      domain,
      sourceUrl: icon.response.url.toString(),
      mimeType: icon.mimeType,
      bytes: icon.bytes,
      title,
    };
  }

  throw new WebsiteIconDiscoveryError("NO_ICON", "没有找到可用的官网图标");
}

/**
 * Resolve a deliberately small allowlist of official domain artwork. This is
 * used for sites whose anti-bot/CDN page prevents reliable favicon discovery.
 * The asset must remain on the mapped domain, use HTTPS, refuse redirects, and
 * pass the same strict SVG validation used by the canonical icon asset loader.
 */
export async function discoverOfficialDomainIcon(
  website: string | URL,
  options: WebsiteIconDiscoveryOptions = {},
): Promise<OfficialDomainIconDiscovery | null> {
  const requestedUrl = normalizeUrl(website);
  const definition = findOfficialDomainIcon(requestedUrl);
  if (!definition) return null;

  const assetUrl = normalizeUrl(definition.assetUrl);
  if (
    assetUrl.protocol !== "https:"
    || assetUrl.port
    || !hostnameMatchesDomain(canonicalHostname(assetUrl), definition.domain)
  ) {
    throw new WebsiteIconDiscoveryError("UNSAFE_URL", "官方图标资源地址与官网域名不匹配");
  }

  const resolvedOptions = resolveOptions({ ...options, maxRedirects: 0 });
  const response = await fetchWithRedirects(assetUrl, resolvedOptions.imageMaxBytes, resolvedOptions);
  if (response.status < 200 || response.status >= 300) {
    throw new WebsiteIconDiscoveryError("HTTP_ERROR", `官方图标返回了 HTTP ${response.status}`);
  }

  const rasterMimeType = detectWebsiteIconMimeType(response.body);
  const validated = rasterMimeType
    ? { mimeType: rasterMimeType, bytes: response.body }
    : prepareOfficialSvg(response.body, definition);

  return {
    website: `https://${definition.domain}/`,
    domain: definition.domain,
    sourceUrl: response.url.toString(),
    mimeType: validated.mimeType,
    bytes: validated.bytes,
    title: definition.displayName,
    upstreamSha256: createHash("sha256").update(response.body).digest("hex"),
    mappedDomain: definition.domain,
  };
}

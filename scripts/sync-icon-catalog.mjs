import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = resolve(projectRoot, "lib/icon-source-lock.json");
const domainOverridesPath = resolve(projectRoot, "lib/icon-catalog-domain-overrides.json");
const outputPath = resolve(projectRoot, "lib/generated/icon-catalog.json");
const outputVersion = 1;
const neutralAccent = "#64748b";
const catalogDomainOverrides = JSON.parse(await readFile(domainOverridesPath, "utf8"));

const mimeTypes = {
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const initialisms = new Map(
  [
    "ai",
    "api",
    "aws",
    "cdn",
    "css",
    "dns",
    "gpt",
    "hd",
    "html",
    "http",
    "https",
    "ide",
    "ip",
    "ios",
    "iot",
    "js",
    "llm",
    "nas",
    "npm",
    "pdf",
    "php",
    "rss",
    "sdk",
    "sql",
    "ssh",
    "ssl",
    "tv",
    "ui",
    "url",
    "usb",
    "vpn",
    "vps",
    "xml",
  ].map((value) => [value, value.toUpperCase()]),
);

const wordOverrides = new Map([
  ["chatgpt", "ChatGPT"],
  ["cloudflare", "Cloudflare"],
  ["github", "GitHub"],
  ["google", "Google"],
  ["icloud", "iCloud"],
  ["openai", "OpenAI"],
  ["postgresql", "PostgreSQL"],
  ["youtube", "YouTube"],
]);

const localMetadata = {
  adobecreativecloud: { title: "Adobe Creative Cloud", accent: "#ff4a85", domain: "adobe.com", aliases: ["Adobe CC"] },
  amazonprime: { title: "Amazon Prime", accent: "#00a8e1", domain: "amazon.com", aliases: ["Prime Video"] },
  apple: { title: "Apple", accent: "#000000", domain: "apple.com", aliases: [] },
  applepay: { title: "Apple Pay", accent: "#000000", domain: "apple.com", aliases: [] },
  chatgpt: { title: "ChatGPT", accent: "#10a37f", domain: "chatgpt.com", aliases: ["OpenAI"] },
  cloudflare: { title: "Cloudflare", accent: "#f48120", domain: "cloudflare.com", aliases: [] },
  disneyplus: { title: "Disney+", accent: "#113ccf", domain: "disneyplus.com", aliases: ["Disney Plus"] },
  duolingo: { title: "Duolingo", accent: "#58cc02", domain: "duolingo.com", aliases: [] },
  figma: { title: "Figma", accent: "#f24e1e", domain: "figma.com", aliases: [] },
  github: { title: "GitHub", accent: "#181717", domain: "github.com", aliases: [] },
  googleone: { title: "Google One", accent: "#4285f4", domain: "one.google.com", aliases: [] },
  googlepay: { title: "Google Pay", accent: "#4285f4", domain: "pay.google.com", aliases: ["GPay"] },
  icloud: { title: "iCloud", accent: "#3693f3", domain: "icloud.com", aliases: [] },
  mastercard: { title: "Mastercard", accent: "#eb001b", domain: "mastercard.com", aliases: [] },
  netflix: { title: "Netflix", accent: "#e50914", domain: "netflix.com", aliases: [] },
  notion: { title: "Notion", accent: "#000000", domain: "notion.so", aliases: [] },
  spotify: { title: "Spotify", accent: "#1ed760", domain: "spotify.com", aliases: [] },
  twitter: { title: "X / Twitter", accent: "#1d9bf0", domain: "x.com", aliases: ["X", "Twitter"] },
  visa: { title: "Visa", accent: "#1434cb", domain: "visa.com", aliases: [] },
  youtube: { title: "YouTube", accent: "#ff0000", domain: "youtube.com", aliases: [] },
};

// Upstream titles are mostly language-neutral. Apply one product-owned alias
// layer to every provider so a Chinese query can compare the available artwork
// styles instead of being forced onto the Simple Icons fallback.
const localizedBrandAliases = [
  { pattern: /^(?:ali-?yun|alibaba-?cloud)$/, aliases: ["阿里云"] },
  { pattern: /^alipay$/, aliases: ["支付宝"] },
  { pattern: /^bilibili(?:-\d+)?$/, aliases: ["哔哩哔哩", "B站"] },
  { pattern: /^(?:sina)?weibo$/, aliases: ["微博", "新浪微博"] },
  { pattern: /^taobao$/, aliases: ["淘宝"] },
  { pattern: /^tiktok(?:-\d+|-light)?$/, aliases: ["抖音"] },
  { pattern: /^wechat(?:-\d+)?$/, aliases: ["微信", "微信支付"] },
  { pattern: /^(?:xiaohongshu|rednote)$/, aliases: ["小红书", "红书"] },
  { pattern: /^zhihu$/, aliases: ["知乎"] },
];

function aliasesForBrand(upstreamKey, title) {
  const keys = [upstreamKey, title]
    .map((value) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, "-"));
  return localizedBrandAliases.flatMap(({ pattern, aliases }) =>
    keys.some((key) => pattern.test(key)) ? aliases : [],
  );
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result.sort(compareText);
}

function humanizeWord(rawWord) {
  const lower = rawWord.toLocaleLowerCase("en-US");
  if (wordOverrides.has(lower)) return wordOverrides.get(lower);
  if (initialisms.has(lower)) return initialisms.get(lower);
  if (/^\d+$/.test(lower)) return lower;
  return `${lower.slice(0, 1).toUpperCase()}${lower.slice(1)}`;
}

function humanizeKey(key) {
  return key
    .replace(/[_+.]+/g, "-")
    .split("-")
    .filter(Boolean)
    .map(humanizeWord)
    .join(" ");
}

function fixedAssetUrl(baseUrl, ...pathParts) {
  const encodedPath = pathParts
    .flatMap((part) => String(part).split("/"))
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${baseUrl.replace(/\/$/, "")}/${encodedPath}`;
}

function assertPinnedUrl(url, source) {
  if (typeof url !== "string") throw new Error(`${source} is missing a URL`);
  if (/\/(?:main|master)\//i.test(url) || /@latest\b/i.test(url)) {
    throw new Error(`${source} uses a mutable revision: ${url}`);
  }
}

function assertRemoteSourcePinned(source) {
  for (const [key, value] of Object.entries(source)) {
    if ((key.endsWith("Url") || key === "sourcePage") && /^https?:/.test(String(value))) {
      assertPinnedUrl(String(value), `${source.provider}.${key}`);
    }
  }
}

async function fetchJson(url, label) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "TuD-Icon-Catalog-Sync/1.0",
    },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${label} returned invalid JSON`, { cause: error });
  }
}

function makeEntry(source, upstreamKey, fields) {
  const id = `${source.provider}:${upstreamKey}`;
  const entry = {
    id,
    provider: source.provider,
    upstreamKey,
    title: fields.title,
    aliases: uniqueStrings([...(fields.aliases ?? []), ...aliasesForBrand(upstreamKey, fields.title)]),
    priority: source.priority,
    assetUrl: fields.assetUrl,
    mimeType: fields.mimeType,
    license: source.license,
    sourcePage: source.sourcePage,
    sourceRevision: fields.sourceRevision ?? source.revision,
    accent: fields.accent ?? neutralAccent,
  };
  const domain = fields.domain ?? catalogDomainOverrides[id];
  if (domain) entry.domain = domain;
  return entry;
}

async function readLock() {
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  if (lock.version !== 1 || !lock.sources) throw new Error("Unsupported icon source lock format");
  for (const source of Object.values(lock.sources)) {
    if (source.provider !== "local" && source.provider !== "simple-icons") assertRemoteSourcePinned(source);
  }
  return lock;
}

async function collectLocal(source) {
  const directory = resolve(projectRoot, source.assetsDirectory);
  const files = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && mimeTypes[extname(entry.name).toLocaleLowerCase("en-US")])
    .map((entry) => entry.name)
    .sort(compareText);

  return Promise.all(
    files.map(async (fileName) => {
      const extension = extname(fileName).toLocaleLowerCase("en-US");
      const upstreamKey = basename(fileName, extension);
      const metadata = localMetadata[upstreamKey] ?? {};
      const contents = await readFile(resolve(directory, fileName));
      return makeEntry(source, upstreamKey, {
        title: metadata.title ?? humanizeKey(upstreamKey),
        aliases: metadata.aliases ?? [],
        domain: metadata.domain,
        assetUrl: fixedAssetUrl(source.assetBasePath, fileName),
        mimeType: mimeTypes[extension],
        sourceRevision: `sha256:${sha256(contents)}`,
        accent: metadata.accent,
      });
    }),
  );
}

async function collectHdIcons(source) {
  const manifest = await fetchJson(source.manifestUrl, "HD-Icons icons.json");
  if (!Array.isArray(manifest.icons)) throw new Error("HD-Icons manifest is missing icons[]");

  return manifest.icons.flatMap((icon) => {
    if (!icon || typeof icon.name !== "string" || typeof icon.url !== "string") return [];
    const parsed = new URL(icon.url);
    const marker = "/border-radius/";
    const markerIndex = parsed.pathname.indexOf(marker);
    if (markerIndex < 0) return [];

    const encodedFileName = parsed.pathname.slice(markerIndex + marker.length);
    const fileName = decodeURIComponent(encodedFileName);
    if (!fileName.endsWith(".png") || fileName.includes("/") || fileName.includes("..")) return [];

    const upstreamKey = basename(fileName, ".png");
    const brandKey = upstreamKey.replace(/-\d+$/, "");
    return [
      makeEntry(source, upstreamKey, {
        title: humanizeKey(brandKey),
        aliases: [icon.name, brandKey],
        assetUrl: fixedAssetUrl(source.assetBaseUrl, "border-radius", fileName),
        mimeType: "image/png",
      }),
    ];
  });
}

function dashboardMetadataOwners(metadata) {
  const owners = new Map();
  for (const [key, value] of Object.entries(metadata)) {
    owners.set(key, { key, metadata: value });
    for (const colorKey of Object.values(value?.colors ?? {})) {
      if (typeof colorKey === "string") owners.set(colorKey, { key, metadata: value });
    }
  }
  return owners;
}

async function collectDashboardIcons(source) {
  const [metadata, tree] = await Promise.all([
    fetchJson(source.metadataUrl, "Dashboard Icons metadata.json"),
    fetchJson(source.treeUrl, "Dashboard Icons tree.json"),
  ]);
  if (!metadata || Array.isArray(metadata) || !Array.isArray(tree.svg) || !Array.isArray(tree.webp)) {
    throw new Error("Dashboard Icons metadata/tree format is unsupported");
  }

  const svgFiles = new Set(tree.svg.filter((file) => typeof file === "string" && file.endsWith(".svg")));
  const webpFiles = new Set(tree.webp.filter((file) => typeof file === "string" && file.endsWith(".webp")));
  const upstreamKeys = new Set([
    ...[...svgFiles].map((file) => basename(file, ".svg")),
    ...[...webpFiles].map((file) => basename(file, ".webp")),
  ]);
  const owners = dashboardMetadataOwners(metadata);

  return [...upstreamKeys].sort(compareText).map((upstreamKey) => {
    const owner = owners.get(upstreamKey);
    const ownerKey = owner?.key ?? upstreamKey.replace(/-(?:dark|light)$/, "");
    const suffix = upstreamKey === ownerKey ? "" : upstreamKey.endsWith("-dark") ? " (Dark)" : upstreamKey.endsWith("-light") ? " (Light)" : "";
    const useSvg = svgFiles.has(`${upstreamKey}.svg`);
    const extension = useSvg ? "svg" : "webp";
    return makeEntry(source, upstreamKey, {
      title: `${humanizeKey(ownerKey)}${suffix}`,
      aliases: [ownerKey, ...(owner?.metadata?.aliases ?? [])],
      assetUrl: fixedAssetUrl(source.assetBaseUrl, extension, `${upstreamKey}.${extension}`),
      mimeType: useSvg ? "image/svg+xml" : "image/webp",
    });
  });
}

async function collectLobeIcons(source) {
  const tree = await fetchJson(source.treeUrl, "Lobe Icons Git tree");
  if (!Array.isArray(tree.tree) || tree.truncated) throw new Error("Lobe Icons Git tree is missing or truncated");

  const prefix = "packages/static-svg/icons/";
  return tree.tree
    .filter((item) => item?.type === "blob" && typeof item.path === "string" && item.path.startsWith(prefix) && item.path.endsWith(".svg"))
    .map((item) => item.path)
    .sort(compareText)
    .map((path) => {
      const fileName = basename(path);
      const upstreamKey = basename(fileName, ".svg");
      return makeEntry(source, upstreamKey, {
        title: humanizeKey(upstreamKey),
        aliases: [upstreamKey],
        assetUrl: fixedAssetUrl(source.assetBaseUrl, path),
        mimeType: "image/svg+xml",
      });
    });
}

function splitTags(value) {
  if (typeof value !== "string") return [];
  return value.split(/[,;|]/).map((tag) => tag.trim()).filter(Boolean);
}

async function collectSelfhstIcons(source) {
  const index = await fetchJson(source.indexUrl, "selfh.st index.json");
  if (!Array.isArray(index)) throw new Error("selfh.st index is not an array");

  return index.flatMap((icon) => {
    const upstreamKey = typeof icon?.Reference === "string" ? icon.Reference.trim() : "";
    const title = typeof icon?.Name === "string" ? icon.Name.trim() : "";
    const hasSvg = icon?.SVG === "Yes";
    const hasWebp = icon?.WebP === "Yes";
    if (!upstreamKey || !title || (!hasSvg && !hasWebp)) return [];
    const extension = hasSvg ? "svg" : "webp";
    return [
      makeEntry(source, upstreamKey, {
        title,
        aliases: [upstreamKey, ...splitTags(icon.Tags)],
        assetUrl: fixedAssetUrl(source.assetBaseUrl, extension, `${upstreamKey}.${extension}`),
        mimeType: hasSvg ? "image/svg+xml" : "image/webp",
      }),
    ];
  });
}

async function collectSimpleIcons(source) {
  const catalog = JSON.parse(await readFile(resolve(projectRoot, source.catalogPath), "utf8"));
  if (catalog.version !== source.revision || !Array.isArray(catalog.icons)) {
    throw new Error(`Expected generated Simple Icons ${source.revision}; run npm run brands:generate first`);
  }

  const availableFiles = new Set(
    (await readdir(resolve(projectRoot, source.assetsDirectory), { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name),
  );

  return catalog.icons.map((icon) => {
    const fileName = `${icon.slug}.svg`;
    if (!availableFiles.has(fileName)) throw new Error(`Missing local Simple Icons asset: ${fileName}`);
    return makeEntry(source, icon.slug, {
      title: icon.title,
      aliases: icon.aliases ?? [],
      assetUrl: fixedAssetUrl(source.assetBasePath, fileName),
      mimeType: "image/svg+xml",
      accent: `#${String(icon.hex).toLocaleLowerCase("en-US")}`,
    });
  });
}

function validateEntries(entries) {
  const ids = new Set();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(`Duplicate icon catalog id: ${entry.id}`);
    ids.add(entry.id);
    if (/raw\.githubusercontent\.com\/.+\/(?:main|master)\//i.test(entry.assetUrl) || /@latest\b/i.test(entry.assetUrl)) {
      throw new Error(`Mutable asset URL generated for ${entry.id}`);
    }
  }
  for (const [id, domain] of Object.entries(catalogDomainOverrides)) {
    if (!ids.has(id)) throw new Error(`Domain override references missing catalog icon: ${id}`);
    if (typeof domain !== "string" || !/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])$/i.test(domain) || !domain.includes(".")) {
      throw new Error(`Invalid catalog domain override for ${id}`);
    }
  }
}

const lock = await readLock();
const collectors = [
  ["local", collectLocal],
  ["hd-icons", collectHdIcons],
  ["dashboard-icons", collectDashboardIcons],
  ["lobe-icons", collectLobeIcons],
  ["selfhst-icons", collectSelfhstIcons],
  ["simple-icons", collectSimpleIcons],
];

const results = [];
const counts = {};
for (const [sourceKey, collect] of collectors) {
  const source = lock.sources[sourceKey];
  if (!source) throw new Error(`Missing source lock: ${sourceKey}`);
  const entries = await collect(source);
  counts[source.provider] = entries.length;
  results.push(...entries);
}

results.sort(
  (left, right) =>
    left.priority - right.priority ||
    compareText(left.provider, right.provider) ||
    compareText(left.title, right.title) ||
    compareText(left.upstreamKey, right.upstreamKey),
);
validateEntries(results);

const canonicalPayload = JSON.stringify({ version: outputVersion, entries: results });
const output = {
  version: outputVersion,
  contentHash: `sha256:${sha256(canonicalPayload)}`,
  entries: results,
};

await mkdir(dirname(outputPath), { recursive: true });
const temporaryPath = `${outputPath}.tmp`;
await writeFile(temporaryPath, `${JSON.stringify(output)}\n`);
await rename(temporaryPath, outputPath);

for (const [provider, count] of Object.entries(counts)) console.log(`${provider}: ${count}`);
console.log(`total: ${results.length}`);
console.log(`content hash: ${output.contentHash}`);

import "server-only";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  monogramIconId,
  monogramUpstreamKey,
  normalizeMonogramAccent,
  normalizeMonogramText,
} from "../lib/monogram-icon";
import { db } from "./index";
import { iconAssets, iconCatalog, iconCatalogState } from "./schema";

const WEBSITE_PROVIDER = "website-domain";
export const MONOGRAM_PROVIDER = "monogram";
const MAX_CATALOG_ENTRIES = 50_000;
const MAX_ICON_BYTES = 4 * 1024 * 1024;
const WRITE_CHUNK_SIZE = 250;
const ALLOWED_MIME_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/vnd.microsoft.icon",
  "image/webp",
  "image/x-icon",
]);

type JsonMetadata = Record<string, unknown>;

export type IconCatalogEntryInput = {
  id?: unknown;
  provider: unknown;
  upstreamKey: unknown;
  displayName?: unknown;
  title?: unknown;
  aliases?: unknown;
  priority?: unknown;
  mimeType?: unknown;
  license?: unknown;
  sourcePage?: unknown;
  sourceRevision?: unknown;
  assetUrl?: unknown;
  websiteDomain?: unknown;
  domain?: unknown;
  accent?: unknown;
  assetSha256?: unknown;
  metadata?: unknown;
};

export type IconCatalogSeedEntry = Omit<IconCatalogEntryInput, "provider">;

export type IconAssetInput = {
  contentBase64: unknown;
  mimeType: unknown;
  sha256?: unknown;
  width?: unknown;
  height?: unknown;
  metadata?: unknown;
};

export type WebsiteDomainIconInput = {
  website: unknown;
  displayName?: unknown;
  aliases?: unknown;
  priority?: unknown;
  mimeType?: unknown;
  license?: unknown;
  sourcePage?: unknown;
  sourceRevision?: unknown;
  assetUrl?: unknown;
  accent?: unknown;
  metadata?: unknown;
  asset?: IconAssetInput | null;
};

type PreparedCatalogEntry = typeof iconCatalog.$inferInsert;
type PreparedAsset = typeof iconAssets.$inferInsert;

function normalizeSingleLine(value: unknown, field: string, maxLength: number) {
  if (typeof value !== "string") throw new Error(`${field}格式不正确`);
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, maxLength);
  if (!normalized) throw new Error(`${field}不能为空`);
  return normalized;
}

export function normalizeIconProvider(value: unknown) {
  const provider = normalizeSingleLine(value, "图标来源", 64).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(provider)) throw new Error("图标来源格式不正确");
  return provider;
}

function normalizeUpstreamKey(value: unknown) {
  return normalizeSingleLine(value, "图标标识", 240);
}

function normalizeCatalogId(value: unknown, provider: string, upstreamKey: string) {
  if (value != null && value !== "") {
    const id = normalizeSingleLine(value, "图标 ID", 320);
    if (!/^[a-z0-9][a-z0-9:._-]*$/i.test(id)) throw new Error("图标 ID 格式不正确");
    return id;
  }
  const readableId = `${provider}:${upstreamKey}`;
  if (readableId.length <= 320 && /^[a-z0-9][a-z0-9:._-]*$/i.test(readableId)) return readableId;
  const digest = createHash("sha256").update(upstreamKey).digest("hex").slice(0, 32);
  return `${provider}:sha256-${digest}`;
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeAliases(value: unknown) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error("图标别名格式不正确");
  const aliases: string[] = [];
  const seen = new Set<string>();
  for (const item of value.slice(0, 48)) {
    if (typeof item !== "string") continue;
    const alias = item.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, 120);
    const key = alias.toLowerCase();
    if (!alias || seen.has(key)) continue;
    seen.add(key);
    aliases.push(alias);
  }
  return aliases;
}

function normalizeHttpUrl(value: unknown, field: string) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error(`${field}格式不正确`);
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    if (url.username || url.password) throw new Error();
    return url.toString().slice(0, 1_000);
  } catch {
    throw new Error(`${field}必须是有效的 http(s) 地址`);
  }
}

function normalizeAssetUrl(value: unknown) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error("图标资源地址格式不正确");
  const raw = value.trim();
  if (raw.startsWith("/")) {
    if (!raw.startsWith("/brands/") || raw.includes("..") || raw.includes("\\") || raw.includes("?") || raw.includes("#")) {
      throw new Error("本地图标资源必须位于 /brands/ 下");
    }
    if (!/^\/brands\/[a-z0-9._~!$&'()+,;=:@%/-]+$/i.test(raw)) throw new Error("本地图标资源地址格式不正确");
    return raw.slice(0, 1_000);
  }
  const normalized = normalizeHttpUrl(raw, "图标资源地址");
  if (!normalized) return null;
  const url = new URL(normalized);
  const sensitiveKeys = new Set(["auth", "credential", "key", "password", "secret", "signature", "token"]);
  for (const key of url.searchParams.keys()) {
    if (sensitiveKeys.has(key.toLowerCase())) throw new Error("图标资源地址不能包含访问凭据");
  }
  return normalized;
}

export function normalizeWebsiteIconDomain(value: unknown) {
  if (typeof value !== "string") throw new Error("网站域名格式不正确");
  const raw = value.trim();
  if (!raw) throw new Error("网站域名不能为空");
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    if (url.username || url.password) throw new Error();
    const domain = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
    if (!domain || domain.length > 253 || domain === "localhost" || domain.endsWith(".local") || isIP(domain)) {
      throw new Error();
    }
    const labels = domain.split(".");
    if (labels.length < 2 || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
      throw new Error();
    }
    return domain;
  } catch {
    throw new Error("网站域名格式不正确");
  }
}

function normalizeOptionalDomain(value: unknown) {
  if (value == null || value === "") return null;
  return normalizeWebsiteIconDomain(value);
}

function normalizeAccent(value: unknown) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error("图标颜色格式不正确");
  const accent = value.trim().slice(0, 32);
  if (!/^(?:#[0-9a-f]{3,8}|[a-z][a-z0-9-]{0,31})$/i.test(accent)) throw new Error("图标颜色格式不正确");
  return accent;
}

function normalizePriority(value: unknown) {
  if (value == null || value === "") return 1_000;
  const priority = Number(value);
  if (!Number.isSafeInteger(priority) || priority < 0 || priority > 1_000_000) throw new Error("图标优先级不正确");
  return priority;
}

function normalizeOptionalSingleLine(value: unknown, field: string, maxLength: number) {
  if (value == null || value === "") return null;
  return normalizeSingleLine(value, field, maxLength);
}

function normalizeMimeType(value: unknown) {
  if (value == null || value === "") return null;
  const mimeType = normalizeSingleLine(value, "图标类型", 80).toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(mimeType)) throw new Error("不支持该图标格式");
  return mimeType;
}

function normalizeSha256(value: unknown, nullable = true) {
  if (value == null || value === "") {
    if (nullable) return null;
    throw new Error("图标摘要不能为空");
  }
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/i.test(value.trim())) throw new Error("图标摘要格式不正确");
  return value.trim().toLowerCase();
}

function normalizeMetadata(value: unknown, field = "图标元数据") {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error(`${field}格式不正确`);
  try {
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, "utf8") > 64 * 1024) throw new Error();
    return JSON.parse(serialized) as JsonMetadata;
  } catch {
    throw new Error(`${field}格式不正确或过大`);
  }
}

function normalizeDimension(value: unknown, field: string) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > 32_768) throw new Error(`${field}不正确`);
  return number;
}

function prepareAsset(input: IconAssetInput): PreparedAsset {
  if (typeof input.contentBase64 !== "string") throw new Error("图标内容格式不正确");
  const compactBase64 = input.contentBase64.replace(/\s+/g, "");
  if (!compactBase64 || !/^[a-z0-9+/]*={0,2}$/i.test(compactBase64)) throw new Error("图标内容不是有效的 Base64");
  const buffer = Buffer.from(compactBase64, "base64");
  if (buffer.length === 0 || buffer.length > MAX_ICON_BYTES) throw new Error("图标文件为空或超过 4MB");

  const mimeType = normalizeSingleLine(input.mimeType, "图标类型", 80).toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(mimeType)) throw new Error("不支持该图标格式");
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const claimedSha256 = normalizeSha256(input.sha256);
  if (claimedSha256 && claimedSha256 !== sha256) throw new Error("图标内容与摘要不一致");

  return {
    sha256,
    contentBase64: buffer.toString("base64"),
    mimeType,
    byteSize: buffer.length,
    width: normalizeDimension(input.width, "图标宽度"),
    height: normalizeDimension(input.height, "图标高度"),
    metadata: normalizeMetadata(input.metadata, "图标资源元数据"),
  };
}

function prepareCatalogEntry(input: IconCatalogEntryInput, forcedId?: string): PreparedCatalogEntry {
  const provider = normalizeIconProvider(input.provider);
  const upstreamKey = normalizeUpstreamKey(input.upstreamKey);
  const displayName = normalizeSingleLine(input.displayName ?? input.title, "图标名称", 160);
  const aliases = normalizeAliases(input.aliases);
  const websiteDomain = normalizeOptionalDomain(input.websiteDomain ?? input.domain);
  const normalizedName = normalizeSearchText(displayName);
  const searchText = normalizeSearchText([
    displayName,
    upstreamKey,
    provider,
    websiteDomain,
    ...aliases,
  ].filter(Boolean).join(" ")).slice(0, 2_000);

  return {
    id: normalizeCatalogId(forcedId ?? input.id, provider, upstreamKey),
    provider,
    upstreamKey,
    displayName,
    normalizedName,
    searchText,
    aliases,
    priority: normalizePriority(input.priority),
    mimeType: normalizeMimeType(input.mimeType),
    license: normalizeOptionalSingleLine(input.license, "图标许可证", 160),
    sourcePage: normalizeHttpUrl(input.sourcePage, "图标来源页面"),
    sourceRevision: normalizeOptionalSingleLine(input.sourceRevision, "图标来源版本", 240),
    assetUrl: normalizeAssetUrl(input.assetUrl),
    websiteDomain,
    accent: normalizeAccent(input.accent),
    assetSha256: normalizeSha256(input.assetSha256),
    metadata: normalizeMetadata(input.metadata),
    isActive: true,
  };
}

function prepareCatalogEntries(entries: readonly IconCatalogEntryInput[]) {
  if (entries.length > MAX_CATALOG_ENTRIES) throw new Error(`单次最多写入 ${MAX_CATALOG_ENTRIES} 个图标`);
  const deduplicated = new Map<string, PreparedCatalogEntry>();
  for (const entry of entries) {
    const prepared = prepareCatalogEntry(entry);
    deduplicated.set(`${prepared.provider}\u0000${prepared.upstreamKey}`, prepared);
  }
  return [...deduplicated.values()];
}

function chunk<T>(items: readonly T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

const catalogConflictUpdate = {
  displayName: sql`excluded.display_name`,
  normalizedName: sql`excluded.normalized_name`,
  searchText: sql`excluded.search_text`,
  aliases: sql`excluded.aliases`,
  priority: sql`excluded.priority`,
  mimeType: sql`excluded.mime_type`,
  license: sql`excluded.license`,
  sourcePage: sql`excluded.source_page`,
  sourceRevision: sql`excluded.source_revision`,
  assetUrl: sql`excluded.asset_url`,
  websiteDomain: sql`excluded.website_domain`,
  accent: sql`excluded.accent`,
  assetSha256: sql`case
    when excluded.asset_url is distinct from ${iconCatalog.assetUrl}
      or excluded.source_revision is distinct from ${iconCatalog.sourceRevision}
      or excluded.mime_type is distinct from ${iconCatalog.mimeType}
    then excluded.asset_sha256
    else coalesce(excluded.asset_sha256, ${iconCatalog.assetSha256})
  end`,
  metadata: sql`excluded.metadata`,
  isActive: true,
  updatedAt: sql`now()`,
} as const;

export async function upsertIconCatalogEntries(entries: readonly IconCatalogEntryInput[]) {
  const prepared = prepareCatalogEntries(entries);
  if (prepared.length === 0) return { upserted: 0 };

  await db.transaction(async (tx) => {
    for (const values of chunk(prepared, WRITE_CHUNK_SIZE)) {
      await tx.insert(iconCatalog).values(values).onConflictDoUpdate({
        target: [iconCatalog.provider, iconCatalog.upstreamKey],
        set: catalogConflictUpdate,
      });
    }
  });
  return { upserted: prepared.length };
}

export async function ensureIconCatalogSeed(input: {
  provider: unknown;
  seedVersion: unknown;
  entries: readonly IconCatalogSeedEntry[];
  metadata?: unknown;
}) {
  const provider = normalizeIconProvider(input.provider);
  const seedVersion = normalizeSingleLine(input.seedVersion, "图标种子版本", 200);
  if (!Array.isArray(input.entries) || input.entries.length === 0) throw new Error("图标种子不能为空");
  const prepared = prepareCatalogEntries(input.entries.map((entry) => ({ ...entry, provider })));
  const metadata = normalizeMetadata(input.metadata, "图标种子元数据");

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`nexdue:icons:${provider}`}, 0))`);
    const [current] = await tx.select().from(iconCatalogState)
      .where(eq(iconCatalogState.provider, provider))
      .limit(1);
    if (current?.seedVersion === seedVersion) return { seeded: false, state: current };

    await tx.update(iconCatalog)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(iconCatalog.provider, provider));

    for (const values of chunk(prepared, WRITE_CHUNK_SIZE)) {
      await tx.insert(iconCatalog).values(values).onConflictDoUpdate({
        target: [iconCatalog.provider, iconCatalog.upstreamKey],
        set: catalogConflictUpdate,
      });
    }

    const now = new Date();
    const [state] = await tx.insert(iconCatalogState).values({
      provider,
      seedVersion,
      entryCount: prepared.length,
      metadata,
      seededAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: iconCatalogState.provider,
      set: { seedVersion, entryCount: prepared.length, metadata, seededAt: now, updatedAt: now },
    }).returning();

    return { seeded: true, state };
  });
}

export async function getIconCatalogState(rawProvider: unknown) {
  const provider = normalizeIconProvider(rawProvider);
  const [state] = await db.select().from(iconCatalogState)
    .where(eq(iconCatalogState.provider, provider))
    .limit(1);
  return state ?? null;
}

export async function searchIcons(rawQuery: unknown, options: {
  limit?: unknown;
  providers?: unknown;
} = {}) {
  const query = typeof rawQuery === "string" ? normalizeSearchText(rawQuery).slice(0, 160) : "";
  const rawLimit = Number(options.limit ?? 24);
  const limit = Number.isSafeInteger(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : 24;
  const providers = Array.isArray(options.providers)
    ? [...new Set(options.providers.map(normalizeIconProvider))].slice(0, 12)
    : [];
  const searchCondition = query
    ? sql`${iconCatalog.searchText} ilike ${`%${query}%`}`
    : sql`true`;
  const providerCondition = providers.length > 0
    ? inArray(iconCatalog.provider, providers)
    : sql`true`;
  const rank = query
    ? sql<number>`case
        when ${iconCatalog.normalizedName} = ${query} then 0
        when ${iconCatalog.normalizedName} like ${`${query}%`} then 1
        else 2
      end`
    : null;
  const ordering = [
    ...(rank ? [rank] : []),
    asc(iconCatalog.priority),
    asc(iconCatalog.displayName),
    asc(iconCatalog.provider),
    asc(iconCatalog.upstreamKey),
  ];

  return db.select({
    id: iconCatalog.id,
    provider: iconCatalog.provider,
    upstreamKey: iconCatalog.upstreamKey,
    displayName: iconCatalog.displayName,
    aliases: iconCatalog.aliases,
    priority: iconCatalog.priority,
    mimeType: iconCatalog.mimeType,
    license: iconCatalog.license,
    sourcePage: iconCatalog.sourcePage,
    sourceRevision: iconCatalog.sourceRevision,
    assetUrl: iconCatalog.assetUrl,
    websiteDomain: iconCatalog.websiteDomain,
    accent: iconCatalog.accent,
    assetSha256: iconCatalog.assetSha256,
    metadata: iconCatalog.metadata,
    hasAsset: sql<boolean>`${iconCatalog.assetSha256} is not null`,
  }).from(iconCatalog)
    .where(and(eq(iconCatalog.isActive, true), searchCondition, providerCondition))
    .orderBy(...ordering)
    .limit(limit);
}

export async function getIconById(rawId: unknown) {
  const id = normalizeSingleLine(rawId, "图标 ID", 320);
  const [record] = await db.select({ catalog: iconCatalog, asset: iconAssets })
    .from(iconCatalog)
    .leftJoin(iconAssets, eq(iconCatalog.assetSha256, iconAssets.sha256))
    .where(eq(iconCatalog.id, id))
    .limit(1);
  return record ?? null;
}

export async function cacheIconAsset(rawIconId: unknown, input: IconAssetInput) {
  const iconId = normalizeSingleLine(rawIconId, "图标 ID", 320);
  const asset = prepareAsset(input);

  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: iconCatalog.id, mimeType: iconCatalog.mimeType }).from(iconCatalog)
      .where(eq(iconCatalog.id, iconId))
      .limit(1)
      .for("update");
    if (!existing) throw new Error("图标不存在");
    if (existing.mimeType && existing.mimeType !== asset.mimeType) throw new Error("图标内容类型与目录不一致");

    await tx.insert(iconAssets).values(asset).onConflictDoNothing({ target: iconAssets.sha256 });
    await tx.update(iconCatalog)
      .set({ assetSha256: asset.sha256, mimeType: asset.mimeType, updatedAt: new Date() })
      .where(eq(iconCatalog.id, iconId));

    const [record] = await tx.select({ catalog: iconCatalog, asset: iconAssets })
      .from(iconCatalog)
      .leftJoin(iconAssets, eq(iconCatalog.assetSha256, iconAssets.sha256))
      .where(eq(iconCatalog.id, iconId))
      .limit(1);
    return record;
  });
}

export async function createOrUpdateWebsiteDomainIcon(input: WebsiteDomainIconInput) {
  const domain = normalizeWebsiteIconDomain(input.website);
  const asset = input.asset ? prepareAsset(input.asset) : null;
  const entry = prepareCatalogEntry({
    provider: WEBSITE_PROVIDER,
    upstreamKey: domain,
    displayName: input.displayName || domain,
    aliases: input.aliases,
    priority: input.priority,
    mimeType: input.asset ? asset?.mimeType : input.mimeType,
    license: input.license,
    sourcePage: input.sourcePage,
    sourceRevision: input.sourceRevision,
    assetUrl: input.assetUrl,
    websiteDomain: domain,
    accent: input.accent,
    assetSha256: asset?.sha256,
    metadata: input.metadata,
  }, `website:${domain}`);

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`nexdue:website-icon:${domain}`}, 0))`);
    if (asset) await tx.insert(iconAssets).values(asset).onConflictDoNothing({ target: iconAssets.sha256 });

    const [catalog] = await tx.insert(iconCatalog).values(entry).onConflictDoUpdate({
      target: [iconCatalog.provider, iconCatalog.upstreamKey],
      set: catalogConflictUpdate,
    }).returning();

    const [record] = await tx.select({ catalog: iconCatalog, asset: iconAssets })
      .from(iconCatalog)
      .leftJoin(iconAssets, eq(iconCatalog.assetSha256, iconAssets.sha256))
      .where(eq(iconCatalog.id, catalog.id))
      .limit(1);
    return record;
  });
}

export async function createOrGetMonogramIcon(rawText: unknown, rawAccent?: unknown) {
  const text = normalizeMonogramText(rawText);
  const accent = normalizeMonogramAccent(rawAccent, text);
  const upstreamKey = monogramUpstreamKey(text, accent);
  const iconId = monogramIconId(text, accent);
  const entry = prepareCatalogEntry({
    id: iconId,
    provider: MONOGRAM_PROVIDER,
    upstreamKey,
    displayName: text,
    aliases: [],
    // Monograms are user-created fallbacks and never belong in curated
    // recommendations. Product search also excludes this provider entirely.
    priority: 1_000_000,
    license: "User-created artwork",
    sourceRevision: "monogram-v2-color",
    // The generic catalog accepts CSS-style hex values; subscriptions and the
    // client continue to receive the normalized bare six-digit value.
    accent: `#${accent}`,
    metadata: { kind: "monogram", text, accent },
  }, iconId);

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`tud:monogram-icon:${upstreamKey}`}, 0))`);
    const [catalog] = await tx.insert(iconCatalog).values(entry).onConflictDoUpdate({
      target: [iconCatalog.provider, iconCatalog.upstreamKey],
      set: catalogConflictUpdate,
    }).returning();
    const [record] = await tx.select({ catalog: iconCatalog, asset: iconAssets })
      .from(iconCatalog)
      .leftJoin(iconAssets, eq(iconCatalog.assetSha256, iconAssets.sha256))
      .where(eq(iconCatalog.id, catalog.id))
      .limit(1);
    return record ?? null;
  });
}

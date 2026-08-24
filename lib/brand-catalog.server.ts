import "server-only";
import {
  ensureIconCatalogSeed,
  findIconByWebsiteDomain,
  getIconCatalogState,
  getIconById,
  searchIcons,
  type IconCatalogSeedEntry,
} from "../db/icons";
import type { BrandChoice } from "./brand-options";
import {
  monogramAccentFromIconId,
  monogramTextFromIconId,
  monogramUpstreamKeyFromIconId,
  normalizeMonogramAccent,
} from "./monogram-icon";
import generatedCatalog from "./generated/icon-catalog.json";

type GeneratedIcon = {
  id: string;
  provider: string;
  upstreamKey: string;
  title: string;
  aliases?: string[];
  domain?: string;
  priority: number;
  assetUrl: string;
  mimeType: string;
  license: string;
  sourcePage: string;
  sourceRevision: string;
  accent: string;
};

type SearchRecord = Awaited<ReturnType<typeof searchIcons>>[number];
const KNOWN_PROVIDERS = ["local", "hd-icons", "dashboard-icons", "lobe-icons", "selfhst-icons", "simple-icons"] as const;
const SEARCH_PROVIDERS = [...KNOWN_PROVIDERS, "website-domain"] as const;
const entries = generatedCatalog.entries as GeneratedIcon[];
const entriesByProvider = Map.groupBy(entries, (entry) => entry.provider);
const legacyLocalEntries = new Map(
  (entriesByProvider.get("local") ?? []).map((entry) => [entry.upstreamKey, entry]),
);
let seedPromise: Promise<void> | null = null;

function httpSourcePage(value: string) {
  return /^https?:\/\//i.test(value) ? value : null;
}

function seedEntry(entry: GeneratedIcon): IconCatalogSeedEntry {
  return {
    id: entry.id,
    upstreamKey: entry.upstreamKey,
    displayName: entry.title,
    aliases: entry.aliases ?? [],
    priority: entry.priority,
    mimeType: entry.mimeType,
    license: entry.license,
    sourcePage: httpSourcePage(entry.sourcePage),
    sourceRevision: entry.sourceRevision,
    assetUrl: entry.assetUrl,
    websiteDomain: entry.domain,
    accent: entry.accent,
    metadata: { catalogVersion: generatedCatalog.version },
  };
}

export async function ensureServerIconCatalog() {
  if (!seedPromise) {
    seedPromise = (async () => {
      for (const provider of KNOWN_PROVIDERS) {
        const providerEntries = entriesByProvider.get(provider) ?? [];
        if (!providerEntries.length) continue;
        const seedVersion = `${generatedCatalog.version}:${generatedCatalog.contentHash}:${providerEntries[0]?.sourceRevision ?? "unknown"}`;
        const current = await getIconCatalogState(provider);
        if (current?.seedVersion === seedVersion) continue;
        await ensureIconCatalogSeed({
          provider,
          seedVersion,
          entries: providerEntries.map(seedEntry),
          metadata: { contentHash: generatedCatalog.contentHash, count: providerEntries.length },
        });
      }
    })().catch((error) => {
      seedPromise = null;
      throw error;
    });
  }
  return seedPromise;
}

function normalizedAccent(value: string | null | undefined) {
  const accent = value?.trim().replace(/^#/, "") ?? "";
  return /^[0-9a-f]{6}$/i.test(accent) || /^[a-z][a-z0-9-]{0,31}$/i.test(accent) ? accent.toLowerCase() : "blue";
}

function sourceForProvider(provider: string): BrandChoice["source"] {
  if (provider === "monogram") return "monogram";
  if (provider === "local") return "local";
  if (provider === "hd-icons" || provider === "hd") return "hd-icons";
  if (provider === "dashboard-icons" || provider === "dashboard") return "dashboard-icons";
  if (provider === "lobe-icons" || provider === "lobe") return "lobe-icons";
  if (provider === "selfhst-icons" || provider === "selfhst") return "selfhst-icons";
  if (provider === "website" || provider === "website-domain") return "website";
  return "simple-icons";
}

function legacyKey(provider: string, upstreamKey: string) {
  if (provider === "monogram") return `monogram:${upstreamKey}`;
  if (provider === "local" && /^[a-z0-9_]{1,80}$/.test(upstreamKey)) return upstreamKey;
  if ((provider === "simple-icons" || provider === "simple") && /^[a-z0-9_]{1,80}$/.test(upstreamKey)) return `simple-${upstreamKey}`;
  return "fallback";
}

function brandChoice(record: SearchRecord): BrandChoice {
  return {
    iconId: record.id,
    iconKey: legacyKey(record.provider, record.upstreamKey),
    title: record.displayName,
    accent: normalizedAccent(record.accent),
    source: sourceForProvider(record.provider),
    license: record.license ?? undefined,
    domain: record.websiteDomain,
  };
}

export async function searchBrands(rawQuery: string, rawLimit = 24): Promise<BrandChoice[]> {
  await ensureServerIconCatalog();
  const query = rawQuery.trim().replace(/\s+/g, " ").slice(0, 64);
  const limit = Math.max(1, Math.min(24, Math.trunc(rawLimit) || 24));
  // Website discoveries are shared, dynamic catalog records rather than a
  // product-curated default set. Keep them searchable without letting one
  // user's discoveries (or duplicate site entries) leak into everyone's
  // empty-state recommendations.
  const records = await searchIcons(query, {
    limit,
    providers: query ? SEARCH_PROVIDERS : KNOWN_PROVIDERS,
  });
  return records.map(brandChoice);
}

export async function findBrandByWebsite(rawWebsite: unknown): Promise<BrandChoice | null> {
  await ensureServerIconCatalog();
  const record = await findIconByWebsiteDomain(rawWebsite, { providers: KNOWN_PROVIDERS });
  return record ? brandChoice(record) : null;
}

function normalizeLegacyIconKey(rawIconKey: unknown) {
  const rawKey = typeof rawIconKey === "string" ? rawIconKey.trim() : "";
  if (rawKey.startsWith("monogram:")) {
    const text = monogramTextFromIconId(rawKey);
    const accent = monogramAccentFromIconId(rawKey);
    if (!text || !accent) throw new Error("请选择有效图标");
    return { iconId: rawKey, iconKey: rawKey, accent };
  }
  const iconKey = rawKey.toLowerCase();
  if (iconKey === "fallback" || iconKey === "sparkles" || !iconKey) return { iconId: null, iconKey: "fallback", accent: "blue" };
  const local = legacyLocalEntries.get(iconKey);
  if (local) return { iconId: local.id, iconKey: local.upstreamKey, accent: normalizedAccent(local.accent) };
  if (!iconKey.startsWith("simple-")) throw new Error("请选择有效图标");
  const slug = iconKey.slice("simple-".length);
  if (!/^[a-z0-9_]{1,80}$/.test(slug)) throw new Error("请选择有效图标");
  return { iconId: `simple-icons:${slug}`, iconKey: `simple-${slug}`, accent: "ink" };
}

export async function normalizeBrandSelection(rawIconId: unknown, rawIconKey?: unknown) {
  await ensureServerIconCatalog();
  const legacy = normalizeLegacyIconKey(rawIconKey);
  const iconId = typeof rawIconId === "string" && rawIconId.trim() ? rawIconId.trim().slice(0, 260) : legacy.iconId;
  if (!iconId) throw new Error("请选择图标");

  const record = await getIconById(iconId);
  if (!record?.catalog || !record.catalog.isActive) throw new Error("请选择有效图标");
  if (record.catalog.provider === "monogram") {
    const text = monogramTextFromIconId(record.catalog.id);
    const indexedUpstreamKey = monogramUpstreamKeyFromIconId(record.catalog.id);
    if (!text || !indexedUpstreamKey || record.catalog.upstreamKey !== indexedUpstreamKey) throw new Error("请选择有效图标");
    const accent = normalizeMonogramAccent(record.catalog.accent, text);
    const idAccent = monogramAccentFromIconId(record.catalog.id);
    if (!idAccent || (indexedUpstreamKey.includes(".") && idAccent !== accent)) throw new Error("请选择有效图标");
    return {
      iconId: record.catalog.id,
      iconKey: record.catalog.id,
      accent,
    };
  }
  return {
    iconId: record.catalog.id,
    iconKey: legacyKey(record.catalog.provider, record.catalog.upstreamKey),
    accent: normalizedAccent(record.catalog.accent),
  };
}

export type BrandChoice = {
  iconId: string | null;
  iconKey: string;
  title: string;
  accent: string;
  source: "local" | "hd-icons" | "dashboard-icons" | "lobe-icons" | "selfhst-icons" | "simple-icons" | "website" | "monogram";
  sourceLabel?: string;
  license?: string;
  domain?: string | null;
};

export const brandSourceLabels: Record<BrandChoice["source"], string> = {
  local: "精选图标",
  "hd-icons": "HD-Icons",
  "dashboard-icons": "Dashboard Icons",
  "lobe-icons": "Lobe Icons",
  "selfhst-icons": "selfh.st Icons",
  "simple-icons": "Simple Icons",
  website: "官网图标",
  monogram: "字母图标",
};

// This placeholder is UI state, not an icon catalog entry. Every selectable
// icon, including bundled artwork, is resolved from the server index.
export const emptyBrandChoice: BrandChoice = {
  iconId: null,
  iconKey: "fallback",
  accent: "blue",
  title: "未选择图标",
  source: "local",
  sourceLabel: "默认图标",
};

function responseBrandSource(value: unknown): BrandChoice["source"] {
  return typeof value === "string" && Object.hasOwn(brandSourceLabels, value)
    ? value as BrandChoice["source"]
    : "website";
}

function responseIconKey(value: unknown, iconId: string) {
  const iconKey = typeof value === "string" ? value.trim() : "";
  if (/^[a-z0-9][a-z0-9:._-]{0,319}$/i.test(iconKey)) return iconKey;
  const simpleSlug = iconId.match(/^simple-icons:([a-z0-9_]{1,80})$/)?.[1];
  if (simpleSlug) return `simple-${simpleSlug}`;
  const localKey = iconId.match(/^local:([a-z0-9_]{1,80})$/)?.[1];
  return localKey ?? "fallback";
}

export function websiteBrandChoiceFromResponse(raw: unknown, fallbackHostname: string): BrandChoice {
  if (!raw || typeof raw !== "object") throw new Error("官网图标响应格式不正确");
  const record = raw as Record<string, unknown>;
  const iconId = typeof record.iconId === "string" ? record.iconId.trim() : "";
  if (!/^[a-z0-9][a-z0-9:._-]{1,319}$/i.test(iconId)) {
    throw new Error("官网图标没有写入服务端索引");
  }

  const title = typeof record.title === "string" && record.title.trim()
    ? record.title.trim().slice(0, 160)
    : fallbackHostname;
  const rawAccent = typeof record.accent === "string" ? record.accent.trim().replace(/^#/, "") : "";
  const accent = /^[0-9a-f]{6}$/i.test(rawAccent) || /^[a-z][a-z0-9-]{0,31}$/i.test(rawAccent)
    ? rawAccent.toLowerCase()
    : "blue";
  const domain = typeof record.domain === "string" && record.domain.trim()
    ? record.domain.trim().toLowerCase().slice(0, 253)
    : fallbackHostname;
  const license = typeof record.license === "string" && record.license.trim()
    ? record.license.trim().slice(0, 160)
    : undefined;
  const source = responseBrandSource(record.source);
  const sourceLabel = typeof record.sourceLabel === "string" && record.sourceLabel.trim()
    ? record.sourceLabel.trim().slice(0, 80)
    : source === "website" ? "官方网站" : brandSourceLabels[source];

  return {
    iconId,
    // Catalog hits keep their bundled fast path; malformed or legacy responses
    // still fall back to the indexed same-origin asset route through iconId.
    iconKey: responseIconKey(record.iconKey, iconId),
    title,
    accent,
    source,
    sourceLabel,
    license,
    domain,
  };
}

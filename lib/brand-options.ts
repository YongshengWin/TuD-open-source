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

  return {
    iconId,
    // Website assets always render through the indexed same-origin route.
    // Keep the legacy key explicit so older or malformed API responses cannot
    // crash the preview while React renders the newly discovered choice.
    iconKey: "fallback",
    title,
    accent,
    source: "website",
    sourceLabel: "官方网站",
    license,
    domain,
  };
}

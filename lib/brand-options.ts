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

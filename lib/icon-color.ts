const namedAccents: Record<string, string> = {
  blue: "#2768ed",
  cyan: "#0ea5c6",
  green: "#159a65",
  ink: "#202938",
  orange: "#d97706",
  pink: "#db4f7d",
  red: "#dc3f4f",
  violet: "#7057d9",
  yellow: "#b77900",
};

type Rgb = { r: number; g: number; b: number };

function parseHex(value: string): Rgb | null {
  const normalized = value.trim().replace(/^#/, "");
  const expanded = /^[0-9a-f]{3}$/i.test(normalized)
    ? [...normalized].map((part) => `${part}${part}`).join("")
    : normalized;
  if (!/^[0-9a-f]{6}$/i.test(expanded)) return null;
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

function toHex({ r, g, b }: Rgb) {
  return `#${[r, g, b].map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

function mix(color: Rgb, target: Rgb, targetWeight: number) {
  return toHex({
    r: color.r * (1 - targetWeight) + target.r * targetWeight,
    g: color.g * (1 - targetWeight) + target.g * targetWeight,
    b: color.b * (1 - targetWeight) + target.b * targetWeight,
  });
}

function luminance({ r, g, b }: Rgb) {
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return channel(r) * 0.2126 + channel(g) * 0.7152 + channel(b) * 0.0722;
}

function contrastRatio(first: Rgb, second: Rgb) {
  const lighter = Math.max(luminance(first), luminance(second));
  const darker = Math.min(luminance(first), luminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

function darkenForWhiteText(color: Rgb, targetContrast = 4.8) {
  const white = parseHex("#ffffff")!;
  const navy = parseHex("#101a2c")!;
  if (contrastRatio(color, white) >= targetContrast) return toHex(color);

  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const weight = (low + high) / 2;
    const candidate = parseHex(mix(color, navy, weight))!;
    if (contrastRatio(candidate, white) >= targetContrast) high = weight;
    else low = weight;
  }
  return mix(color, navy, high);
}

export function normalizedIconColor(accent: string | null | undefined) {
  const raw = accent?.trim().toLowerCase() ?? "";
  const named = namedAccents[raw];
  if (named) return named;
  const parsed = parseHex(raw);
  return parsed ? toHex(parsed) : namedAccents.blue;
}

export function iconBannerTheme(accent: string | null | undefined) {
  const base = parseHex(normalizedIconColor(accent))!;
  const navy = parseHex("#101a2c")!;
  const white = parseHex("#ffffff")!;
  const bright = luminance(base) > 0.38;
  return {
    base: toHex(base),
    start: mix(base, navy, bright ? 0.46 : 0.24),
    end: mix(base, navy, 0.76),
    glow: mix(base, white, 0.16),
  };
}

/**
 * Builds a quiet, paper-like surface from the same source color as the icon.
 * Every wash stays close to white so artwork remains true to its brand and
 * the dark subscription copy keeps reliable contrast.
 */
export function iconSurfaceTheme(accent: string | null | undefined) {
  const base = parseHex(normalizedIconColor(accent))!;
  const white = parseHex("#ffffff")!;
  const lavender = parseHex("#dfe5f4")!;
  const warmPaper = parseHex("#f4e8df")!;
  const coolCompanion = parseHex(mix(base, lavender, 0.48))!;
  const warmCompanion = parseHex(mix(base, warmPaper, 0.58))!;

  return {
    base: toHex(base),
    washPrimary: mix(base, white, 0.84),
    washCool: mix(coolCompanion, white, 0.7),
    washWarm: mix(warmCompanion, white, 0.76),
    border: mix(base, white, 0.72),
  };
}

export function monogramIconTheme(accent: string | null | undefined) {
  const base = parseHex(normalizedIconColor(accent))!;
  const navy = parseHex("#101a2c")!;
  const start = darkenForWhiteText(base);
  return {
    base: toHex(base),
    start,
    end: mix(parseHex(start)!, navy, 0.42),
  };
}

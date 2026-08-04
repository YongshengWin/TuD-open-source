"use client";

import Image from "next/image";
import { ImageOff } from "lucide-react";
import { type SyntheticEvent, useEffect } from "react";
import { SIMPLE_ICONS_VERSION } from "../../lib/generated/brand-version";
import { monogramIconTheme } from "../../lib/icon-color";
import { monogramGraphemeCount, monogramTextFromIconId } from "../../lib/monogram-icon";

const brandIcons = new Set([
  "adobecreativecloud",
  "amazonprime",
  "apple",
  "applepay",
  "chatgpt",
  "cloudflare",
  "disneyplus",
  "duolingo",
  "figma",
  "github",
  "googleone",
  "googlepay",
  "icloud",
  "mastercard",
  "netflix",
  "notion",
  "spotify",
  "twitter",
  "visa",
  "youtube",
]);

const fullColorIcons = new Set([
  "amazonprime",
  "applepay",
  "disneyplus",
  "googleone",
  "googlepay",
  "mastercard",
  "twitter",
  "visa",
  "youtube",
]);

function simpleIconSlug(iconKey: string, iconId?: string | null) {
  const indexedSlug = iconId?.match(/^(?:simple|simple-icons):([a-z0-9_]{1,80})$/)?.[1];
  if (indexedSlug) return indexedSlug;
  if (!iconKey.startsWith("simple-")) return null;
  const slug = iconKey.slice("simple-".length);
  return /^[a-z0-9_]{1,80}$/.test(slug) ? slug : null;
}

function brandColor(accent: string) {
  return /^[0-9a-f]{6}$/i.test(accent) ? `#${accent}` : undefined;
}

function needsDarkSurface(accent: string) {
  if (!/^[0-9a-f]{6}$/i.test(accent)) return false;
  const channel = (value: string) => {
    const component = Number.parseInt(value, 16) / 255;
    return component <= 0.03928 ? component / 12.92 : ((component + 0.055) / 1.055) ** 2.4;
  };
  const luminance = channel(accent.slice(0, 2)) * 0.2126
    + channel(accent.slice(2, 4)) * 0.7152
    + channel(accent.slice(4, 6)) * 0.0722;
  return 1.05 / (luminance + 0.05) < 2;
}

function localIconKey(iconId?: string | null) {
  const match = iconId?.match(/^local:([a-z0-9_]{1,80})$/);
  return match?.[1] ?? null;
}

function indexedIconUrl(iconId?: string | null) {
  if (!iconId || !/^[a-z0-9][a-z0-9:._-]{1,190}$/i.test(iconId)) return null;
  if (iconId.startsWith("local:") || iconId.startsWith("simple:") || iconId.startsWith("simple-icons:") || iconId.startsWith("monogram:")) return null;
  return `/api/icons/${encodeURIComponent(iconId)}`;
}

export function brandIconImageUrl(iconId: string | null | undefined, iconKey: string) {
  if (monogramTextFromIconId(iconId) ?? monogramTextFromIconId(iconKey)) return null;
  const indexedLocalKey = localIconKey(iconId);
  const resolvedIconKey = indexedLocalKey && brandIcons.has(indexedLocalKey) ? indexedLocalKey : iconKey;
  const remoteSlug = simpleIconSlug(resolvedIconKey, iconId);
  const assetUrl = indexedIconUrl(iconId);
  if (assetUrl) return assetUrl;
  if (remoteSlug) return `/brands/simple/${SIMPLE_ICONS_VERSION}/${remoteSlug}.svg`;
  if (brandIcons.has(resolvedIconKey)) return `/brands/${resolvedIconKey}.svg`;
  return null;
}

function dominantImageColor(image: HTMLImageElement) {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 24;
    canvas.height = 24;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    type ColorBucket = { count: number; saturation: number; r: number; g: number; b: number };
    const buckets = new Map<string, ColorBucket>();
    for (let index = 0; index < pixels.length; index += 4) {
      const alpha = pixels[index + 3] / 255;
      if (alpha < 0.45) continue;
      const r = pixels[index];
      const g = pixels[index + 1];
      const b = pixels[index + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (min > 242 || max < 14) continue;
      const saturation = max ? (max - min) / max : 0;
      const qr = Math.round(r / 24) * 24;
      const qg = Math.round(g / 24) * 24;
      const qb = Math.round(b / 24) * 24;
      const key = `${qr}:${qg}:${qb}`;
      const current = buckets.get(key) ?? { count: 0, saturation: 0, r: 0, g: 0, b: 0 };
      current.count += alpha;
      current.saturation += saturation * alpha;
      current.r += r * alpha;
      current.g += g * alpha;
      current.b += b * alpha;
      buckets.set(key, current);
    }
    let winner: ColorBucket | null = null;
    let winningScore = 0;
    for (const bucket of buckets.values()) {
      const averageSaturation = bucket.saturation / bucket.count;
      const score = bucket.count * (0.28 + averageSaturation * 1.9);
      if (score > winningScore) {
        winner = bucket;
        winningScore = score;
      }
    }
    if (!winner) return null;
    return `#${[winner.r, winner.g, winner.b]
      .map((value) => Math.round(value / winner.count).toString(16).padStart(2, "0"))
      .join("")}`;
  } catch {
    return null;
  }
}

type BrandIconProps = {
  iconId?: string | null;
  iconKey: string;
  accent: string;
  size?: number;
  onColorResolved?: (color: string) => void;
};

export function BrandIcon({ iconId = null, iconKey, accent, size = 52, onColorResolved }: BrandIconProps) {
  const monogramText = monogramTextFromIconId(iconId) ?? monogramTextFromIconId(iconKey);
  const indexedLocalKey = localIconKey(iconId);
  const resolvedIconKey = indexedLocalKey && brandIcons.has(indexedLocalKey) ? indexedLocalKey : iconKey;
  const remoteSlug = simpleIconSlug(resolvedIconKey, iconId);
  const indexedAssetUrl = indexedIconUrl(iconId);
  const key = monogramText ? "monogram" : brandIcons.has(resolvedIconKey) ? resolvedIconKey : remoteSlug ? "simple" : indexedAssetUrl ? "indexed" : "fallback";
  const darkSurface = Boolean(remoteSlug && needsDarkSurface(accent));
  const monogramTheme = monogramText ? monogramIconTheme(accent) : null;
  const monogramBase = monogramTheme?.base;
  const monogramLength = monogramText ? monogramGraphemeCount(monogramText) : 0;
  const style = {
    width: size,
    height: size,
    ...(remoteSlug ? { color: brandColor(accent) } : {}),
    ...(darkSurface ? { backgroundColor: "#202938", borderColor: "#202938" } : {}),
    ...(monogramTheme ? {
      background: `linear-gradient(145deg, ${monogramTheme.start}, ${monogramTheme.end})`,
      borderColor: monogramTheme.start,
    } : {}),
  };
  const glyphUrl = remoteSlug
    ? `/brands/simple/${SIMPLE_ICONS_VERSION}/${remoteSlug}.svg`
    : `/brands/${key}.svg`;
  const resolveImageColor = onColorResolved
    ? (event: SyntheticEvent<HTMLImageElement>) => {
      const color = dominantImageColor(event.currentTarget);
      if (color) onColorResolved(color);
    }
    : undefined;

  useEffect(() => {
    if (monogramBase && onColorResolved) onColorResolved(monogramBase);
  }, [monogramBase, onColorResolved]);

  return (
    <span className={`brand-icon brand-${accent} brand-key-${key}`} style={style} aria-hidden="true">
      {monogramText ? (
        <span
          className="brand-monogram"
          style={{
            fontSize: Math.max(10, Math.round(size * ([0, .43, .34, .27, .23, .2][monogramLength] ?? .2))),
            letterSpacing: monogramLength > 1 ? "-.045em" : "0",
          }}
        >{monogramText}</span>
      ) : indexedAssetUrl ? (
        // Indexed assets are already validated and cached by TuD's own
        // same-origin route. Bypassing the Next optimizer also preserves SVG
        // providers without enabling global SVG optimization.
        <Image src={indexedAssetUrl} alt="" width={size} height={size} unoptimized onLoad={resolveImageColor} />
      ) : key === "fallback" ? (
        <ImageOff className="brand-empty-glyph" size={Math.round(size * .42)} strokeWidth={1.7} />
      ) : fullColorIcons.has(key) ? (
        <Image src={`/brands/${key}.svg`} alt="" width={size} height={size} unoptimized onLoad={resolveImageColor} />
      ) : (
        <span
          className="brand-glyph"
          style={{ maskImage: `url(${glyphUrl})`, WebkitMaskImage: `url(${glyphUrl})` }}
        />
      )}
    </span>
  );
}

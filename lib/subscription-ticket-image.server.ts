import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { getIconById } from "../db/icons";
import type { SubscriptionRecord } from "../db/subscriptions";
import { SIMPLE_ICONS_VERSION } from "./generated/brand-version";
import { monogramTextFromIconId } from "./monogram-icon";
import { billingCycleLabel, currencyFractionDigits, minorToMajor } from "./subscription-options";
import { formatCurrencyAmount, formatMonthlySpend, monthlySpendByCurrency } from "./subscription-display";

type TicketGroup = { name: string; subscriptions: SubscriptionRecord[] };

export type SubscriptionTicketImageInput = {
  number: string;
  generatedAt: Date;
  nearestDueDate: string | null;
  monthlyTotal: { currencyCode: string; amount: number } | null;
  groups: TicketGroup[];
};

const COLORS = {
  canvas: "#e9edf3",
  paper: "#fffefb",
  navy: "#17243a",
  muted: "#7c899c",
  line: "#dce3ec",
  blue: "#2768ed",
  icon: "#f7f9fc",
};

function xml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function clipped(value: string, length: number) {
  const characters = Array.from(value);
  return characters.length > length ? `${characters.slice(0, Math.max(1, length - 1)).join("")}…` : value;
}

function ticketDate(value: string | null) {
  if (!value) return "未设置到期日";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[1]}年${Number(match[2])}月${Number(match[3])}日` : "未设置到期日";
}

function generatedDate(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

function money(item: SubscriptionRecord) {
  if (item.amountMinor == null) return "—";
  return formatCurrencyAmount(minorToMajor(item.amountMinor, item.currencyCode), item.currencyCode, currencyFractionDigits(item.currencyCode));
}

function groupSubtotal(items: readonly SubscriptionRecord[]) {
  const totals = monthlySpendByCurrency(items);
  return totals.length ? totals.map((item) => formatMonthlySpend(item.amount, item.currency)).join(" · ") : "暂无周期费用";
}

function publicAssetPath(iconId: string | null, iconKey: string) {
  // Public assets are copied into the runtime image separately; do not add a
  // duplicate copy of the generated catalog to this route's server trace.
  const publicRoot = path.join(/*turbopackIgnore: true*/ process.cwd(), "public");
  const simple = iconId?.match(/^(?:simple|simple-icons):([a-z0-9_]{1,80})$/)?.[1]
    ?? iconKey.match(/^simple-([a-z0-9_]{1,80})$/)?.[1];
  if (simple) return path.join(publicRoot, "brands", "simple", SIMPLE_ICONS_VERSION, `${simple}.svg`);
  const local = iconId?.match(/^local:([a-z0-9_]{1,80})$/)?.[1];
  if (local) return path.join(publicRoot, "brands", `${local}.svg`);
  return null;
}

async function iconDataUrl(item: SubscriptionRecord) {
  try {
    const publicPath = publicAssetPath(item.iconId, item.iconKey);
    if (publicPath) return `data:image/svg+xml;base64,${(await readFile(publicPath)).toString("base64")}`;
    if (!item.iconId || item.iconId.startsWith("monogram:")) return null;
    const record = await getIconById(item.iconId);
    if (!record?.asset) return null;
    if (record.asset.mimeType === "image/svg+xml") {
      return `data:image/svg+xml;base64,${record.asset.contentBase64}`;
    }
    const normalized = await sharp(Buffer.from(record.asset.contentBase64, "base64"))
      .resize(88, 88, { fit: "contain", withoutEnlargement: true, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    return `data:image/png;base64,${normalized.toString("base64")}`;
  } catch {
    return null;
  }
}

function iconFallback(item: SubscriptionRecord) {
  return clipped(monogramTextFromIconId(item.iconId) ?? monogramTextFromIconId(item.iconKey) ?? item.name.slice(0, 2).toUpperCase(), 5);
}

export async function renderSubscriptionTicketPng(input: SubscriptionTicketImageInput) {
  const subscriptions = input.groups.flatMap((group) => group.subscriptions);
  if (subscriptions.length > 100) throw new Error("单张订阅票最多展示 100 项订阅");

  const iconUrls = new Map(await Promise.all(subscriptions.map(async (item) => [item.id, await iconDataUrl(item)] as const)));
  const width = 1080;
  const outer = 42;
  const left = 98;
  const right = 982;
  const headerHeight = 190;
  const summaryHeight = 150;
  const groupHeaderHeight = 58;
  const rowHeight = 104;
  const groupGap = 28;
  const footerHeight = 100;
  const contentHeight = input.groups.reduce((sum, group) => sum + groupHeaderHeight + group.subscriptions.length * rowHeight + groupGap, 0);
  const paperHeight = 18 + headerHeight + summaryHeight + 28 + contentHeight + footerHeight;
  const height = paperHeight + outer * 2;
  const font = "'WenQuanYi Zen Hei','Noto Sans CJK SC','Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif";
  const mono = "ui-monospace,'SFMono-Regular',monospace";
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="${COLORS.canvas}"/>`,
    `<rect x="${outer}" y="${outer}" width="${width - outer * 2}" height="${paperHeight}" rx="12" fill="${COLORS.paper}"/>`,
    `<path d="M54 ${outer}h972a12 12 0 0 1 12 12v6H42v-6a12 12 0 0 1 12-12z" fill="${COLORS.navy}"/>`,
    `<rect x="${left}" y="104" width="38" height="38" rx="9" fill="${COLORS.navy}"/>`,
    `<text x="117" y="131" text-anchor="middle" fill="#fff" font-family="${font}" font-size="18" font-weight="700">T</text>`,
    `<text x="150" y="132" fill="${COLORS.navy}" font-family="${font}" font-size="25" font-weight="700">TuD 订阅通票</text>`,
    `<text x="${left}" y="209" fill="${COLORS.navy}" font-family="${font}" font-size="52" font-weight="700">我的订阅票</text>`,
    `<text x="${right}" y="108" text-anchor="end" fill="${COLORS.muted}" font-family="${font}" font-size="17">票号</text>`,
    `<text x="${right}" y="142" text-anchor="end" fill="${COLORS.navy}" font-family="${mono}" font-size="21" font-weight="700">${xml(input.number)}</text>`,
    `<text x="${right}" y="178" text-anchor="end" fill="${COLORS.muted}" font-family="${font}" font-size="17">生成于 ${xml(generatedDate(input.generatedAt))}</text>`,
  ];

  let y = outer + 18 + headerHeight;
  parts.push(`<line x1="${left}" x2="${right}" y1="${y}" y2="${y}" stroke="${COLORS.navy}" stroke-width="1.5"/>`);
  const summary = [
    { label: `预计月均支出 · ${input.monthlyTotal?.currencyCode ?? "—"}`, value: input.monthlyTotal ? formatCurrencyAmount(input.monthlyTotal.amount, input.monthlyTotal.currencyCode, currencyFractionDigits(input.monthlyTotal.currencyCode)) : "—" },
    { label: "订阅数量", value: `${subscriptions.length} 项` },
    { label: "最近续费", value: input.nearestDueDate ? ticketDate(input.nearestDueDate) : "暂无" },
  ];
  const summaryWidth = (right - left) / 3;
  summary.forEach((item, index) => {
    const x = left + summaryWidth * index;
    if (index) parts.push(`<line x1="${x}" x2="${x}" y1="${y + 26}" y2="${y + 112}" stroke="${COLORS.line}"/>`);
    const textX = x + (index ? 28 : 0);
    parts.push(`<text x="${textX}" y="${y + 48}" fill="${COLORS.muted}" font-family="${font}" font-size="17">${xml(item.label)}</text>`);
    parts.push(`<text x="${textX}" y="${y + 91}" fill="${COLORS.navy}" font-family="${font}" font-size="${index === 2 ? 24 : 34}" font-weight="700">${xml(clipped(item.value, index === 2 ? 12 : 15))}</text>`);
  });
  parts.push(`<line x1="${left}" x2="${right}" y1="${y + summaryHeight}" y2="${y + summaryHeight}" stroke="${COLORS.navy}"/>`);

  y += summaryHeight + 42;
  input.groups.forEach((group, groupIndex) => {
    parts.push(`<rect x="${left}" y="${y + 4}" width="34" height="24" rx="5" fill="none" stroke="${COLORS.line}"/>`);
    parts.push(`<text x="${left + 17}" y="${y + 21}" text-anchor="middle" fill="${COLORS.muted}" font-family="${mono}" font-size="13" font-weight="700">${String(groupIndex + 1).padStart(2, "0")}</text>`);
    parts.push(`<text x="${left + 48}" y="${y + 24}" fill="${COLORS.navy}" font-family="${font}" font-size="22" font-weight="700">${xml(clipped(group.name, 20))}</text>`);
    parts.push(`<text x="${right}" y="${y + 23}" text-anchor="end" fill="${COLORS.muted}" font-family="${font}" font-size="16">月均小计 ${xml(clipped(groupSubtotal(group.subscriptions), 34))}</text>`);
    parts.push(`<line x1="${left}" x2="${right}" y1="${y + 42}" y2="${y + 42}" stroke="${COLORS.line}"/>`);
    y += groupHeaderHeight;

    group.subscriptions.forEach((item) => {
      const iconX = left + 2;
      const iconY = y + 18;
      parts.push(`<rect x="${iconX}" y="${iconY}" width="68" height="68" rx="14" fill="${COLORS.icon}" stroke="${COLORS.line}"/>`);
      const iconUrl = iconUrls.get(item.id);
      if (iconUrl) parts.push(`<image href="${iconUrl}" x="${iconX + 12}" y="${iconY + 12}" width="44" height="44" preserveAspectRatio="xMidYMid meet"/>`);
      else parts.push(`<text x="${iconX + 34}" y="${iconY + 42}" text-anchor="middle" fill="${COLORS.blue}" font-family="${font}" font-size="18" font-weight="700">${xml(iconFallback(item))}</text>`);
      parts.push(`<text x="${left + 92}" y="${y + 43}" fill="${COLORS.navy}" font-family="${font}" font-size="22" font-weight="700">${xml(clipped(item.name, 28))}</text>`);
      parts.push(`<text x="${left + 92}" y="${y + 70}" fill="${COLORS.muted}" font-family="${font}" font-size="16">${xml(item.billingCycle === "lifetime" ? "永久有效" : `${ticketDate(item.dueDate)} 到期`)}</text>`);
      parts.push(`<text x="${right}" y="${y + 42}" text-anchor="end" fill="${COLORS.navy}" font-family="${font}" font-size="22" font-weight="700">${xml(money(item))}</text>`);
      parts.push(`<text x="${right}" y="${y + 68}" text-anchor="end" fill="${COLORS.muted}" font-family="${font}" font-size="15">${xml(billingCycleLabel(item.billingCycle))}</text>`);
      y += rowHeight;
    });
    y += groupGap;
  });

  parts.push(`<line x1="${left}" x2="${right}" y1="${y + 2}" y2="${y + 2}" stroke="${COLORS.line}" stroke-dasharray="5 8"/>`);
  parts.push(`<text x="${left}" y="${y + 50}" fill="${COLORS.muted}" font-family="${font}" font-size="16">由 TuD 生成 · ${xml(generatedDate(input.generatedAt))}</text>`);
  parts.push("</svg>");

  return sharp(Buffer.from(parts.join("")), { density: 96 })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

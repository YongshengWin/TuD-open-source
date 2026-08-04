"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Download, Ticket, X } from "lucide-react";
import type { SubscriptionRecord } from "../../db/subscriptions";
import { billingCycleLabel, currencyFractionDigits, currencyOptions, minorToMajor, type SupportedCurrency } from "../../lib/subscription-options";
import { formatCurrencyAmount, formatMonthlySpend, monthlySpendByCurrency, totalMonthlySpendInCurrency } from "../../lib/subscription-display";
import { groupSubscriptionsByCategory } from "../../lib/subscription-order";
import { monogramTextFromIconId } from "../../lib/monogram-icon";
import { BrandIcon, brandIconImageUrl } from "./BrandIcon";

type TicketGroup = { name: string; items: SubscriptionRecord[] };

const colors = {
  canvas: "#e9edf3",
  paper: "#fffefb",
  navy: "#17243a",
  muted: "#7c899c",
  line: "#dce3ec",
  blue: "#2768ed",
  icon: "#f7f9fc",
};

function ticketDate(value: string | null) {
  if (!value) return "未设置到期日";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return "未设置到期日";
  return `${match[1]}年${Number(match[2])}月${Number(match[3])}日`;
}

function money(item: SubscriptionRecord) {
  if (item.amountMinor == null) return "—";
  return formatCurrencyAmount(minorToMajor(item.amountMinor, item.currencyCode), item.currencyCode, currencyFractionDigits(item.currencyCode));
}

function makeGroups(subscriptions: readonly SubscriptionRecord[], categories: readonly string[]) {
  const ordered = groupSubscriptionsByCategory([...subscriptions], [...categories]);
  const groups: TicketGroup[] = [];
  for (const item of ordered) {
    const current = groups.at(-1);
    if (current?.name === item.groupName) current.items.push(item);
    else groups.push({ name: item.groupName, items: [item] });
  }
  return groups;
}

function groupSubtotal(items: readonly SubscriptionRecord[]) {
  const totals = monthlySpendByCurrency(items);
  if (!totals.length) return "暂无周期费用";
  return totals.map((item) => formatMonthlySpend(item.amount, item.currency)).join(" · ");
}

function nearestDueDate(items: readonly SubscriptionRecord[]) {
  const today = new Date().toISOString().slice(0, 10);
  return items
    .map((item) => item.dueDate)
    .filter((value): value is string => Boolean(value && value >= today))
    .sort()[0] ?? null;
}

function generatedDate() {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function ticketNumber(count: number) {
  const key = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `TUD-${key}-${String(count).padStart(2, "0")}`;
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function clippedText(context: CanvasRenderingContext2D, value: string, x: number, y: number, maxWidth: number) {
  if (context.measureText(value).width <= maxWidth) {
    context.fillText(value, x, y);
    return;
  }
  let result = value;
  while (result.length > 1 && context.measureText(`${result}…`).width > maxWidth) result = result.slice(0, -1);
  context.fillText(`${result}…`, x, y);
}

async function drawTicket(
  subscriptions: SubscriptionRecord[],
  categories: string[],
  monthlyTotal: { currencyCode: SupportedCurrency; amount: number } | null,
) {
  await document.fonts.ready;
  const groups = makeGroups(subscriptions, categories);
  const width = 1080;
  const outer = 42;
  const paperWidth = width - outer * 2;
  const headerHeight = 190;
  const summaryHeight = 150;
  const groupHeaderHeight = 58;
  const rowHeight = 104;
  const groupGap = 28;
  const footerHeight = 100;
  const contentHeight = groups.reduce((sum, group) => sum + groupHeaderHeight + group.items.length * rowHeight + groupGap, 0);
  const paperHeight = 18 + headerHeight + summaryHeight + 28 + contentHeight + footerHeight;
  const height = paperHeight + outer * 2;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法生成图片");

  context.fillStyle = colors.canvas;
  context.fillRect(0, 0, width, height);
  context.save();
  context.shadowColor = "rgba(23, 36, 58, .12)";
  context.shadowBlur = 28;
  context.shadowOffsetY = 12;
  roundedRect(context, outer, outer, paperWidth, paperHeight, 12);
  context.fillStyle = colors.paper;
  context.fill();
  context.restore();
  context.save();
  roundedRect(context, outer, outer, paperWidth, paperHeight, 12);
  context.clip();
  context.fillStyle = colors.navy;
  context.fillRect(outer, outer, paperWidth, 18);
  context.restore();

  const left = outer + 56;
  const right = width - outer - 56;
  let y = outer + 62;
  context.fillStyle = colors.navy;
  roundedRect(context, left, y, 38, 38, 9);
  context.fill();
  context.fillStyle = "#fff";
  context.font = "700 18px Inter, system-ui, sans-serif";
  context.fillText("T", left + 13, y + 26);
  context.fillStyle = colors.navy;
  context.font = "700 25px Inter, 'Noto Sans SC', system-ui, sans-serif";
  context.fillText("TuD 订阅通票", left + 52, y + 28);
  context.font = "700 52px Inter, 'Noto Sans SC', system-ui, sans-serif";
  context.fillText("我的订阅票", left, y + 105);
  context.textAlign = "right";
  context.fillStyle = colors.muted;
  context.font = "500 17px Inter, 'Noto Sans SC', system-ui, sans-serif";
  context.fillText("票号", right, y + 4);
  context.fillStyle = colors.navy;
  context.font = "700 21px ui-monospace, SFMono-Regular, monospace";
  context.fillText(ticketNumber(subscriptions.length), right, y + 34);
  context.fillStyle = colors.muted;
  context.font = "500 17px Inter, 'Noto Sans SC', system-ui, sans-serif";
  context.fillText(`生成于 ${generatedDate()}`, right, y + 70);
  context.textAlign = "left";

  y = outer + 18 + headerHeight;
  context.strokeStyle = colors.navy;
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(left, y);
  context.lineTo(right, y);
  context.stroke();
  const summary = [
    { label: `预计每月支出 · ${monthlyTotal?.currencyCode ?? "—"}`, value: monthlyTotal ? formatMonthlySpend(monthlyTotal.amount, monthlyTotal.currencyCode) : "—" },
    { label: "订阅数量", value: `${subscriptions.length} 项` },
    { label: "最近续费", value: nearestDueDate(subscriptions) ? ticketDate(nearestDueDate(subscriptions)) : "暂无" },
  ];
  const summaryWidth = (right - left) / 3;
  summary.forEach((item, index) => {
    const x = left + summaryWidth * index;
    if (index) {
      context.strokeStyle = colors.line;
      context.beginPath();
      context.moveTo(x, y + 26);
      context.lineTo(x, y + 112);
      context.stroke();
    }
    context.fillStyle = colors.muted;
    context.font = "500 17px Inter, 'Noto Sans SC', system-ui, sans-serif";
    context.fillText(item.label, x + (index ? 28 : 0), y + 48);
    context.fillStyle = colors.navy;
    context.font = `700 ${index === 2 ? 26 : 34}px Inter, 'Noto Sans SC', system-ui, sans-serif`;
    clippedText(context, item.value, x + (index ? 28 : 0), y + 91, summaryWidth - 42);
  });
  context.strokeStyle = colors.navy;
  context.beginPath();
  context.moveTo(left, y + summaryHeight);
  context.lineTo(right, y + summaryHeight);
  context.stroke();

  const uniqueUrls = [...new Set(subscriptions.map((item) => brandIconImageUrl(item.iconId, item.iconKey)).filter((url): url is string => Boolean(url)))];
  const loaded = new Map<string, HTMLImageElement | null>(await Promise.all(uniqueUrls.map(async (url) => [url, await loadImage(url)] as const)));
  y += summaryHeight + 42;
  groups.forEach((group, groupIndex) => {
    context.fillStyle = colors.muted;
    roundedRect(context, left, y + 4, 34, 24, 5);
    context.strokeStyle = colors.line;
    context.stroke();
    context.fillStyle = colors.muted;
    context.font = "700 13px ui-monospace, SFMono-Regular, monospace";
    context.fillText(String(groupIndex + 1).padStart(2, "0"), left + 8, y + 21);
    context.fillStyle = colors.navy;
    context.font = "700 22px Inter, 'Noto Sans SC', system-ui, sans-serif";
    context.fillText(group.name, left + 48, y + 24);
    context.textAlign = "right";
    context.fillStyle = colors.muted;
    context.font = "500 16px Inter, 'Noto Sans SC', system-ui, sans-serif";
    context.fillText(`月均小计 ${groupSubtotal(group.items)}`, right, y + 23);
    context.textAlign = "left";
    context.strokeStyle = colors.line;
    context.beginPath();
    context.moveTo(left, y + 42);
    context.lineTo(right, y + 42);
    context.stroke();
    y += groupHeaderHeight;

    group.items.forEach((item) => {
      const iconX = left + 2;
      const iconY = y + 18;
      roundedRect(context, iconX, iconY, 68, 68, 14);
      context.fillStyle = colors.icon;
      context.fill();
      context.strokeStyle = colors.line;
      context.stroke();
      const url = brandIconImageUrl(item.iconId, item.iconKey);
      const image = url ? loaded.get(url) : null;
      if (image) context.drawImage(image, iconX + 12, iconY + 12, 44, 44);
      else {
        const monogram = monogramTextFromIconId(item.iconId) ?? monogramTextFromIconId(item.iconKey) ?? item.name.slice(0, 2).toUpperCase();
        context.fillStyle = colors.blue;
        context.font = "700 18px Inter, 'Noto Sans SC', system-ui, sans-serif";
        context.textAlign = "center";
        context.fillText(monogram.slice(0, 5), iconX + 34, iconY + 41);
        context.textAlign = "left";
      }
      context.fillStyle = colors.navy;
      context.font = "700 22px Inter, 'Noto Sans SC', system-ui, sans-serif";
      clippedText(context, item.name, left + 92, y + 43, 430);
      context.fillStyle = colors.muted;
      context.font = "500 16px Inter, 'Noto Sans SC', system-ui, sans-serif";
      context.fillText(item.billingCycle === "lifetime" ? "永久有效" : `${ticketDate(item.dueDate)} 到期`, left + 92, y + 70);
      context.textAlign = "right";
      context.fillStyle = colors.navy;
      context.font = "700 22px Inter, 'Noto Sans SC', system-ui, sans-serif";
      context.fillText(money(item), right, y + 42);
      context.fillStyle = colors.muted;
      context.font = "500 15px Inter, 'Noto Sans SC', system-ui, sans-serif";
      context.fillText(billingCycleLabel(item.billingCycle), right, y + 68);
      context.textAlign = "left";
      y += rowHeight;
    });
    y += groupGap;
  });

  context.setLineDash([5, 8]);
  context.strokeStyle = colors.line;
  context.beginPath();
  context.moveTo(left, y + 2);
  context.lineTo(right, y + 2);
  context.stroke();
  context.setLineDash([]);
  context.fillStyle = colors.muted;
  context.font = "500 16px Inter, 'Noto Sans SC', system-ui, sans-serif";
  context.fillText(`由 TuD 生成 · ${generatedDate()}`, left, y + 50);
  return canvas;
}

export function SubscriptionTicketModal({
  subscriptions,
  categories,
  initialSummaryCurrency,
  initialExchangeRates,
  onClose,
}: {
  subscriptions: SubscriptionRecord[];
  categories: string[];
  initialSummaryCurrency: SupportedCurrency;
  initialExchangeRates: Record<string, number> | null;
  onClose: () => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [summaryCurrency, setSummaryCurrency] = useState<SupportedCurrency>(initialSummaryCurrency);
  const [fetchedExchangeRates, setFetchedExchangeRates] = useState<Record<string, number> | null>(null);
  const [exchangeRateError, setExchangeRateError] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(subscriptions.map((item) => item.id)));
  const selectionGroups = useMemo(() => makeGroups(subscriptions, categories), [subscriptions, categories]);
  const selectedSubscriptions = useMemo(() => subscriptions.filter((item) => selectedIds.has(item.id)), [subscriptions, selectedIds]);
  const groups = useMemo(() => makeGroups(selectedSubscriptions, categories), [selectedSubscriptions, categories]);
  const monthly = useMemo(() => monthlySpendByCurrency(selectedSubscriptions), [selectedSubscriptions]);
  const exchangeRates = initialExchangeRates ?? fetchedExchangeRates;
  const needsConversion = monthly.some((item) => item.currency !== summaryCurrency);
  const monthlyTotal = useMemo(
    () => totalMonthlySpendInCurrency(monthly, summaryCurrency, exchangeRates),
    [exchangeRates, monthly, summaryCurrency],
  );
  const nearest = nearestDueDate(selectedSubscriptions);

  useEffect(() => {
    if (!needsConversion || exchangeRates) return;
    const controller = new AbortController();
    void fetch("/api/exchange-rates", { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as { rates?: Record<string, number>; error?: string };
        if (!response.ok || !body.rates) throw new Error(body.error ?? "汇率加载失败");
        setFetchedExchangeRates(body.rates);
        setExchangeRateError(false);
      })
      .catch((rateError) => {
        if (rateError instanceof DOMException && rateError.name === "AbortError") return;
        setExchangeRateError(true);
      });
    return () => controller.abort();
  }, [exchangeRates, needsConversion, summaryCurrency]);

  const summaryValue = !monthly.length
    ? "—"
    : monthlyTotal == null
      ? exchangeRateError ? "汇率暂不可用" : "换算中…"
      : formatMonthlySpend(monthlyTotal, summaryCurrency);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", escape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", escape);
    };
  }, [onClose]);

  async function download() {
    setDownloading(true);
    setError("");
    try {
      if (monthly.length && monthlyTotal == null) throw new Error("汇率尚未就绪，请稍后再试");
      const canvas = await drawTicket(
        selectedSubscriptions,
        categories,
        monthlyTotal == null ? null : { currencyCode: summaryCurrency, amount: monthlyTotal },
      );
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("图片生成失败");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `TuD-订阅票-${new Date().toISOString().slice(0, 10)}.png`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "图片生成失败");
    } finally {
      setDownloading(false);
    }
  }

  function toggleSubscription(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleGroup(group: TicketGroup) {
    const allSelected = group.items.every((item) => selectedIds.has(item.id));
    setSelectedIds((current) => {
      const next = new Set(current);
      group.items.forEach((item) => allSelected ? next.delete(item.id) : next.add(item.id));
      return next;
    });
  }

  return (
    <div className="modal-backdrop ticket-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="ticket-modal" role="dialog" aria-modal="true" aria-labelledby="ticket-title">
        <header className="ticket-modal-head">
          <div><span>SUBSCRIPTION PASS</span><h2 id="ticket-title"><Ticket size={22} />订阅票</h2><p>选择需要展示的订阅，按分类生成一张内容自适应的长图。</p></div>
          <div className="ticket-modal-actions">
            <label className="ticket-currency-control"><span>汇总币种</span><select aria-label="订阅票汇总币种" value={summaryCurrency} onChange={(event) => { setExchangeRateError(false); setSummaryCurrency(event.target.value as SupportedCurrency); }}>{currencyOptions.map((option) => <option key={option.value} value={option.value}>{option.value}</option>)}</select><ChevronDown size={13} /></label>
            <button onClick={onClose} aria-label="关闭"><X size={19} /></button>
            <button className="ticket-download" onClick={() => void download()} disabled={downloading || !selectedSubscriptions.length || (monthly.length > 0 && monthlyTotal == null)}><Download size={17} />{downloading ? "正在生成…" : "下载 PNG"}</button>
          </div>
        </header>
        {error && <p className="ticket-error" role="alert">{error}</p>}
        <div className="ticket-builder">
          <aside className="ticket-selector" aria-label="选择订阅">
            <header><div><strong>选择订阅</strong><span>已选 {selectedSubscriptions.length} / {subscriptions.length}</span></div><div><button onClick={() => setSelectedIds(new Set(subscriptions.map((item) => item.id)))}>全选</button><button onClick={() => setSelectedIds(new Set())}>清空</button></div></header>
            <div className="ticket-selector-list">
              {selectionGroups.map((group) => {
                const selectedCount = group.items.filter((item) => selectedIds.has(item.id)).length;
                return <section key={group.name}>
                  <button className="ticket-selector-group" onClick={() => toggleGroup(group)}><span>{group.name}</span><em>{selectedCount}/{group.items.length}</em></button>
                  {group.items.map((item) => <label key={item.id} className={selectedIds.has(item.id) ? "selected" : ""}><input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSubscription(item.id)} /><BrandIcon iconId={item.iconId} iconKey={item.iconKey} accent={item.accent} size={30} /><span>{item.name}</span></label>)}
                </section>;
              })}
            </div>
          </aside>
          <div className="ticket-preview-scroll">
          {selectedSubscriptions.length ? <article className="subscription-ticket" aria-label="订阅票预览">
            <div className="ticket-top-bar" />
            <header className="subscription-ticket-head">
              <div><span className="ticket-brand-mark">T</span><strong>TuD 订阅通票</strong><h3>我的订阅票</h3></div>
              <dl><dt>票号</dt><dd>{ticketNumber(selectedSubscriptions.length)}</dd><dt>生成日期</dt><dd>{generatedDate()}</dd></dl>
            </header>
            <section className="ticket-summary">
              <div><span>预计每月支出 · {summaryCurrency}</span><strong>{summaryValue}</strong></div>
              <div><span>订阅数量</span><strong>{selectedSubscriptions.length} 项</strong></div>
              <div><span>最近续费</span><strong>{nearest ? ticketDate(nearest) : "暂无"}</strong></div>
            </section>
            <div className="ticket-groups">
              {groups.map((group, groupIndex) => (
                <section className="ticket-group" key={group.name}>
                  <header><span>{String(groupIndex + 1).padStart(2, "0")}</span><h4>{group.name}</h4><em>月均小计 {groupSubtotal(group.items)}</em></header>
                  {group.items.map((item) => (
                    <div className="ticket-subscription" key={item.id}>
                      <BrandIcon iconId={item.iconId} iconKey={item.iconKey} accent={item.accent} size={44} />
                      <div><strong>{item.name}</strong><span>{item.billingCycle === "lifetime" ? "永久有效" : `${ticketDate(item.dueDate)} 到期`}</span></div>
                      <div><strong>{money(item)}</strong><span>{billingCycleLabel(item.billingCycle)}</span></div>
                    </div>
                  ))}
                </section>
              ))}
            </div>
            <footer>由 TuD 生成 · {generatedDate()}</footer>
          </article> : <div className="ticket-selection-empty"><Ticket size={28} /><strong>还没有选择订阅</strong><span>从左侧勾选至少一项后即可预览和下载。</span></div>}
          </div>
        </div>
      </section>
    </div>
  );
}

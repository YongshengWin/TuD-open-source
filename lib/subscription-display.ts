import { billingCycleMonths, currencyFractionDigits, minorToMajor } from "./subscription-options.ts";

export function formatCurrencyAmount(amount: number, currency: string, maximumFractionDigits: number) {
  const parts = new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    maximumFractionDigits,
  }).formatToParts(amount);

  return parts.map((part, index) => {
    if (part.type !== "currency") return part.value;
    const previous = parts[index - 1];
    const next = parts[index + 1];
    if (next?.type === "integer") return `${part.value}\u00a0`;
    if (previous?.type === "fraction" || previous?.type === "integer") return `\u00a0${part.value}`;
    return part.value;
  }).join("");
}

export function formatSubscriptionDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return "未设置日期";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  if (Number.isNaN(date.getTime())
    || date.getUTCFullYear() !== Number(match[1])
    || date.getUTCMonth() + 1 !== Number(match[2])
    || date.getUTCDate() !== Number(match[3])) return "未设置日期";
  const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "short", timeZone: "UTC" }).format(date);
  return `${match[1]}/${Number(match[2])}/${Number(match[3])} ${weekday}`;
}

type MonthlySpendItem = {
  amountMinor: number | null;
  billingCycle: string;
  currencyCode: string;
};

export function monthlySpendByCurrency(items: readonly MonthlySpendItem[]) {
  const totals = new Map<string, number>();
  for (const item of items) {
    const months = billingCycleMonths(item.billingCycle);
    if (item.amountMinor == null || months == null) continue;
    const monthlyAmount = minorToMajor(item.amountMinor, item.currencyCode) / months;
    totals.set(item.currencyCode, (totals.get(item.currencyCode) ?? 0) + monthlyAmount);
  }
  return [...totals.entries()]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((left, right) => Number(right.currency === "CNY") - Number(left.currency === "CNY") || left.currency.localeCompare(right.currency));
}

export function formatMonthlySpend(amount: number, currency: string) {
  return formatCurrencyAmount(amount, currency, currencyFractionDigits(currency));
}

export function convertMonthlySpend(
  items: readonly { currency: string; amount: number }[],
  targetCurrency: string,
  usdRates: Readonly<Record<string, number>>,
) {
  const targetRate = usdRates[targetCurrency];
  if (!Number.isFinite(targetRate) || targetRate <= 0) return null;
  let total = 0;
  for (const item of items) {
    const sourceRate = usdRates[item.currency];
    if (!Number.isFinite(sourceRate) || sourceRate <= 0) return null;
    total += (item.amount / sourceRate) * targetRate;
  }
  return total;
}

export function totalMonthlySpendInCurrency(
  items: readonly { currency: string; amount: number }[],
  targetCurrency: string,
  usdRates?: Readonly<Record<string, number>> | null,
) {
  if (!items.length) return 0;
  if (items.every((item) => item.currency === targetCurrency)) {
    return items.reduce((sum, item) => sum + item.amount, 0);
  }
  return usdRates ? convertMonthlySpend(items, targetCurrency, usdRates) : null;
}

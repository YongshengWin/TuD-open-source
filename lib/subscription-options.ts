export const billingCycleOptions = [
  { value: "monthly", label: "每月", months: 1 },
  { value: "quarterly", label: "每季度", months: 3 },
  { value: "semiannual", label: "每半年", months: 6 },
  { value: "yearly", label: "每年", months: 12 },
  { value: "biennial", label: "每两年", months: 24 },
  { value: "triennial", label: "每三年", months: 36 },
  { value: "custom", label: "非固定（指定日期）", months: null },
  { value: "lifetime", label: "永久有效", months: null },
] as const;

export const currencyOptions = [
  { value: "CNY", label: "人民币" },
  { value: "USD", label: "美元" },
  { value: "EUR", label: "欧元" },
  { value: "GBP", label: "英镑" },
  { value: "JPY", label: "日元" },
  { value: "HKD", label: "港币" },
  { value: "TWD", label: "新台币" },
  { value: "KRW", label: "韩元" },
  { value: "SGD", label: "新加坡元" },
  { value: "AUD", label: "澳元" },
  { value: "CAD", label: "加元" },
  { value: "CHF", label: "瑞士法郎" },
  { value: "NZD", label: "新西兰元" },
  { value: "INR", label: "印度卢比" },
  { value: "BRL", label: "巴西雷亚尔" },
  { value: "MXN", label: "墨西哥比索" },
  { value: "SEK", label: "瑞典克朗" },
  { value: "NOK", label: "挪威克朗" },
  { value: "DKK", label: "丹麦克朗" },
  { value: "PLN", label: "波兰兹罗提" },
  { value: "CZK", label: "捷克克朗" },
  { value: "AED", label: "阿联酋迪拉姆" },
  { value: "SAR", label: "沙特里亚尔" },
  { value: "THB", label: "泰铢" },
  { value: "MYR", label: "马来西亚林吉特" },
  { value: "IDR", label: "印尼盾" },
  { value: "PHP", label: "菲律宾比索" },
  { value: "VND", label: "越南盾" },
  { value: "KWD", label: "科威特第纳尔" },
] as const;

export type BillingCycle = (typeof billingCycleOptions)[number]["value"];
export type SupportedCurrency = (typeof currencyOptions)[number]["value"];

const cycleByValue = new Map<string, (typeof billingCycleOptions)[number]>(
  billingCycleOptions.map((option) => [option.value, option]),
);
const supportedCurrencies = new Set<string>(currencyOptions.map((option) => option.value));

export function isBillingCycle(value: unknown): value is BillingCycle {
  return typeof value === "string" && cycleByValue.has(value);
}

export function isSupportedCurrency(value: unknown): value is SupportedCurrency {
  return typeof value === "string" && supportedCurrencies.has(value.toUpperCase());
}

export function billingCycleLabel(value: string) {
  return cycleByValue.get(value)?.label ?? "非固定";
}

export function billingCycleMonths(value: string) {
  return cycleByValue.get(value)?.months ?? null;
}

export function isAutoRenewableCycle(value: string) {
  return billingCycleMonths(value) != null;
}

export function currencyFractionDigits(currencyCode: string) {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency: currencyCode }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

export function majorToMinor(amount: number, currencyCode: string) {
  return Math.round(amount * 10 ** currencyFractionDigits(currencyCode));
}

export function minorToMajor(amountMinor: number, currencyCode: string) {
  return amountMinor / 10 ** currencyFractionDigits(currencyCode);
}

export function addBillingCycle(date: string, cycle: string) {
  const months = billingCycleMonths(cycle);
  if (months == null) throw new Error("此订阅周期不能自动续费");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error("续费日期格式不正确");

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const targetFirst = new Date(Date.UTC(year, monthIndex + months, 1));
  const targetYear = targetFirst.getUTCFullYear();
  const targetMonth = targetFirst.getUTCMonth();
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const result = new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)));
  return result.toISOString().slice(0, 10);
}

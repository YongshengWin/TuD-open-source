import { isSupportedCurrency, type SupportedCurrency } from "./subscription-options.ts";

export const memberIntervalUnits = ["day", "week", "month", "year"] as const;
export type MemberIntervalUnit = (typeof memberIntervalUnits)[number];

export type MemberSchedule = {
  id: string;
  name: string;
  joinedDate: string | null;
  amountMinor: number;
  currencyCode: SupportedCurrency;
  nextDueDate: string;
  intervalCount: number;
  intervalUnit: MemberIntervalUnit;
  reminderEnabled: boolean;
  anchorDay: number;
  lastCollectedAt: string | null;
};

const DAY_MS = 86_400_000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SCHEDULES = 20;
const MAX_NAME_LENGTH = 80;
const MAX_AMOUNT_MINOR = 2_147_483_647;
const MAX_INTERVAL_COUNT: Record<MemberIntervalUnit, number> = {
  day: 3650,
  week: 520,
  month: 120,
  year: 10,
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function validDate(value: unknown, label: string): string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value) || value < "1900-01-01") {
    throw new Error(`${label}格式不正确`);
  }
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label}格式不正确`);
  }
  return value;
}

function validInterval(count: unknown, unit: unknown): asserts unit is MemberIntervalUnit {
  if (typeof unit !== "string" || !memberIntervalUnits.includes(unit as MemberIntervalUnit)) {
    throw new Error("成员收款周期单位不正确");
  }
  if (!Number.isSafeInteger(count) || (count as number) < 1 || (count as number) > MAX_INTERVAL_COUNT[unit as MemberIntervalUnit]) {
    throw new Error(`成员收款周期需为 1–${MAX_INTERVAL_COUNT[unit as MemberIntervalUnit]} ${unit}，最长约 10 年`);
  }
}

export function memberIntervalLabel(count: number, unit: MemberIntervalUnit) {
  if (count === 1) return { day: "每天", week: "每周", month: "每月", year: "每年" }[unit];
  const labels: Record<MemberIntervalUnit, string> = { day: "天", week: "周", month: "个月", year: "年" };
  return `每 ${count} ${labels[unit]}`;
}

export function advanceMemberDueDate(date: string, count: number, unit: MemberIntervalUnit, anchorDay?: number): string {
  validInterval(count, unit);
  const valid = validDate(date, "成员下次收款日期");
  const source = new Date(`${valid}T12:00:00Z`);
  const recurringDay = anchorDay ?? source.getUTCDate();
  if (!Number.isInteger(recurringDay) || recurringDay < 1 || recurringDay > 31) throw new Error("成员收款锚定日期不正确");
  let target: Date;
  if (unit === "day" || unit === "week") {
    target = new Date(source.getTime() + count * (unit === "week" ? 7 : 1) * DAY_MS);
  } else {
    const months = count * (unit === "year" ? 12 : 1);
    const targetFirst = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + months, 1, 12));
    const lastDay = new Date(Date.UTC(targetFirst.getUTCFullYear(), targetFirst.getUTCMonth() + 1, 0, 12)).getUTCDate();
    target = new Date(Date.UTC(targetFirst.getUTCFullYear(), targetFirst.getUTCMonth(), Math.min(recurringDay, lastDay), 12));
  }
  if (Number.isNaN(target.getTime()) || target.getUTCFullYear() > 9999) throw new Error("成员下次收款日期超出支持范围");
  return target.toISOString().slice(0, 10);
}

export function normalizeMemberSchedules(value: unknown, previousSchedules: readonly MemberSchedule[] = [], allowReminder = false): MemberSchedule[] {
  if (!Array.isArray(value) || value.length > MAX_SCHEDULES) {
    throw new Error(`成员收款计划需为数组，最多 ${MAX_SCHEDULES} 位成员`);
  }

  const previousById = new Map(previousSchedules.map((item) => [item.id, item]));
  const ids = new Set<string>();
  const names = new Set<string>();
  return value.map((rawItem, index): MemberSchedule => {
    const item = record(rawItem);
    if (!item) throw new Error(`第 ${index + 1} 位成员格式不正确`);
    const unknownFields = Object.keys(item).filter((key) => ![
      "id", "name", "joinedDate", "amountMinor", "currencyCode", "nextDueDate", "intervalCount", "intervalUnit", "reminderEnabled", "anchorDay", "lastCollectedAt",
    ].includes(key));
    if (unknownFields.length) throw new Error(`成员收款计划包含不支持的字段：${unknownFields.join("、")}`);

    const id = item.id == null ? crypto.randomUUID() : item.id;
    if (typeof id !== "string" || !UUID_PATTERN.test(id)) throw new Error(`第 ${index + 1} 位成员 ID 不正确`);
    if (ids.has(id)) throw new Error("成员 ID 不能重复");
    ids.add(id);
    const previous = previousById.get(id);

    const name = typeof item.name === "string" ? item.name.trim().replace(/\s+/g, " ") : "";
    if (!name || name.length > MAX_NAME_LENGTH) throw new Error(`第 ${index + 1} 位成员名称需为 1–${MAX_NAME_LENGTH} 个字符`);
    const nameKey = name.toLowerCase();
    if (names.has(nameKey)) throw new Error("成员名称不能重复");
    names.add(nameKey);

    const joinedDate = item.joinedDate == null ? null : validDate(item.joinedDate, `第 ${index + 1} 位成员加入日期`);
    if (!Number.isSafeInteger(item.amountMinor) || (item.amountMinor as number) < 0 || (item.amountMinor as number) > MAX_AMOUNT_MINOR) {
      throw new Error(`第 ${index + 1} 位成员金额不正确`);
    }
    const currencyCode = typeof item.currencyCode === "string" ? item.currencyCode.toUpperCase() : "";
    if (!isSupportedCurrency(currencyCode)) throw new Error(`第 ${index + 1} 位成员币种不受支持`);
    const nextDueDate = validDate(item.nextDueDate, `第 ${index + 1} 位成员下次收款日期`);
    validInterval(item.intervalCount, item.intervalUnit);
    if (item.reminderEnabled !== undefined && typeof item.reminderEnabled !== "boolean") {
      throw new Error(`第 ${index + 1} 位成员邮件提醒设置不正确`);
    }
    const anchorDay = previous && previous.nextDueDate === nextDueDate && previous.intervalUnit === item.intervalUnit
      ? previous.anchorDay ?? Number(previous.nextDueDate.slice(-2))
      : Number(nextDueDate.slice(-2));
    if (item.anchorDay !== undefined && item.anchorDay !== anchorDay) {
      throw new Error("成员收款锚定日期由系统记录，不能手动修改");
    }

    const lastCollectedAt = previous?.lastCollectedAt ?? null;
    if (previous && (!Object.hasOwn(item, "lastCollectedAt") || item.lastCollectedAt !== lastCollectedAt)) {
      throw new Error("成员收款状态已变化，请刷新后重试");
    }
    if (!previous && item.lastCollectedAt !== undefined && item.lastCollectedAt !== null) {
      throw new Error("成员收款时间由系统记录，不能手动修改");
    }

    return {
      id,
      name,
      joinedDate,
      amountMinor: item.amountMinor as number,
      currencyCode,
      nextDueDate,
      intervalCount: item.intervalCount as number,
      intervalUnit: item.intervalUnit as MemberIntervalUnit,
      reminderEnabled: allowReminder
        ? item.reminderEnabled === true
        : previous?.reminderEnabled === true && item.reminderEnabled !== false,
      anchorDay,
      lastCollectedAt,
    };
  });
}

import { addBillingCycle, billingCycleMonths } from "./subscription-options.ts";

export type CalendarMonth = {
  year: number;
  month: number;
};

export type CalendarSource = {
  id: string;
  name: string;
  dueDate: string | null;
  billingCycle: string;
  sortPosition?: number;
};

export type CalendarDay = {
  date: string;
  dayOfMonth: number;
  isCurrentMonth: boolean;
  isToday: boolean;
};

export type CalendarOccurrence<T extends CalendarSource = CalendarSource> = {
  date: string;
  isProjected: boolean;
  subscription: T;
};

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function utcDate(date: string) {
  const match = ISO_DATE_PATTERN.exec(date);
  if (!match) return null;
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return formatUtcDate(parsed) === date ? parsed : null;
}

function formatUtcDate(date: Date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function addUtcDays(date: Date, amount: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + amount));
}

export function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function daysUntilLocalDate(date: string | null, now = new Date()) {
  if (!date) return null;
  const target = utcDate(date);
  const today = utcDate(localDateKey(now));
  if (!target || !today) return null;
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function monthFromDateKey(date: string): CalendarMonth {
  const parsed = utcDate(date);
  if (!parsed) throw new Error("日期格式不正确");
  return { year: parsed.getUTCFullYear(), month: parsed.getUTCMonth() + 1 };
}

export function shiftCalendarMonth(value: CalendarMonth, amount: number): CalendarMonth {
  const shifted = new Date(Date.UTC(value.year, value.month - 1 + amount, 1));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 };
}

export function calendarMonthKey(value: CalendarMonth) {
  return `${value.year}-${pad(value.month)}`;
}

export function calendarMonthLabel(value: CalendarMonth) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(value.year, value.month - 1, 1)));
}

export function buildCalendarDays(value: CalendarMonth, today = localDateKey()): CalendarDay[] {
  const first = new Date(Date.UTC(value.year, value.month - 1, 1));
  const last = new Date(Date.UTC(value.year, value.month, 0));
  const mondayOffset = (first.getUTCDay() + 6) % 7;
  const visibleDays = mondayOffset + last.getUTCDate() > 35 ? 42 : 35;
  const gridStart = addUtcDays(first, -mondayOffset);

  return Array.from({ length: visibleDays }, (_, index) => {
    const current = addUtcDays(gridStart, index);
    const date = formatUtcDate(current);
    return {
      date,
      dayOfMonth: current.getUTCDate(),
      isCurrentMonth: current.getUTCMonth() === value.month - 1,
      isToday: date === today,
    };
  });
}

export function calendarOccurrencesForMonth<T extends CalendarSource>(
  subscriptions: readonly T[],
  value: CalendarMonth,
): CalendarOccurrence<T>[] {
  const start = `${value.year}-${pad(value.month)}-01`;
  const end = formatUtcDate(new Date(Date.UTC(value.year, value.month, 0)));
  const occurrences: CalendarOccurrence<T>[] = [];

  for (const subscription of subscriptions) {
    if (!subscription.dueDate || !utcDate(subscription.dueDate) || subscription.billingCycle === "lifetime") continue;

    let occurrenceDate = subscription.dueDate;
    const recurring = billingCycleMonths(subscription.billingCycle) != null;
    let iteration = 0;

    while (recurring && occurrenceDate < start && iteration < 5_000) {
      occurrenceDate = addBillingCycle(occurrenceDate, subscription.billingCycle);
      iteration += 1;
    }

    while (occurrenceDate <= end && iteration < 5_000) {
      if (occurrenceDate >= start) {
        occurrences.push({
          date: occurrenceDate,
          isProjected: occurrenceDate !== subscription.dueDate,
          subscription,
        });
      }
      if (!recurring) break;
      const nextDate = addBillingCycle(occurrenceDate, subscription.billingCycle);
      if (nextDate <= occurrenceDate) break;
      occurrenceDate = nextDate;
      iteration += 1;
    }
  }

  return occurrences.sort((left, right) => {
    const byDate = left.date.localeCompare(right.date);
    if (byDate !== 0) return byDate;
    const byPosition = (left.subscription.sortPosition ?? 0) - (right.subscription.sortPosition ?? 0);
    return byPosition || left.subscription.name.localeCompare(right.subscription.name, "zh-CN");
  });
}

export function groupCalendarOccurrences<T extends CalendarSource>(occurrences: readonly CalendarOccurrence<T>[]) {
  const grouped = new Map<string, CalendarOccurrence<T>[]>();
  for (const occurrence of occurrences) {
    const current = grouped.get(occurrence.date);
    if (current) current.push(occurrence);
    else grouped.set(occurrence.date, [occurrence]);
  }
  return grouped;
}

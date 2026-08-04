"use client";

import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import type { SubscriptionRecord } from "../../db/subscriptions";
import { currencyFractionDigits, minorToMajor } from "../../lib/subscription-options";
import {
  buildCalendarDays,
  calendarMonthKey,
  calendarMonthLabel,
  calendarOccurrencesForMonth,
  groupCalendarOccurrences,
  localDateKey,
  monthFromDateKey,
  shiftCalendarMonth,
  type CalendarOccurrence,
} from "../../lib/subscription-calendar";
import { BrandIcon } from "./BrandIcon";
import styles from "./CalendarView.module.css";

const weekdayLabels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export type CalendarViewProps = {
  subscriptions: SubscriptionRecord[];
  onSelectSubscription: (subscription: SubscriptionRecord, occurrenceDate: string) => void;
  initialDate?: string;
};

function formatAmount(subscription: SubscriptionRecord) {
  if (subscription.amountMinor == null) return null;
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: subscription.currencyCode,
    maximumFractionDigits: currencyFractionDigits(subscription.currencyCode),
  }).format(minorToMajor(subscription.amountMinor, subscription.currencyCode));
}

function formatAgendaDate(date: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

function CalendarEvent({
  occurrence,
  onSelect,
  compact = false,
}: {
  occurrence: CalendarOccurrence<SubscriptionRecord>;
  onSelect: CalendarViewProps["onSelectSubscription"];
  compact?: boolean;
}) {
  const { subscription } = occurrence;
  const amount = formatAmount(subscription);

  return (
    <button
      type="button"
      className={compact ? styles.agendaEvent : styles.calendarEvent}
      onClick={() => onSelect(subscription, occurrence.date)}
      aria-label={`查看 ${subscription.name}，${formatAgendaDate(occurrence.date)}到期`}
    >
      <BrandIcon
        iconId={subscription.iconId}
        iconKey={subscription.iconKey}
        accent={subscription.accent}
        size={compact ? 34 : 25}
      />
      <span className={styles.eventCopy}>
        <strong>{subscription.name}</strong>
        {compact && <small>{subscription.groupName}{amount ? ` · ${amount}` : ""}</small>}
      </span>
      {!compact && amount && <span className={styles.eventAmount}>{amount}</span>}
    </button>
  );
}

function CalendarIconEvent({
  occurrence,
  onSelect,
}: {
  occurrence: CalendarOccurrence<SubscriptionRecord>;
  onSelect: CalendarViewProps["onSelectSubscription"];
}) {
  const { subscription } = occurrence;
  const label = `查看 ${subscription.name}，${formatAgendaDate(occurrence.date)}到期`;

  return (
    <button
      type="button"
      className={styles.iconEvent}
      onClick={() => onSelect(subscription, occurrence.date)}
      aria-label={label}
      title={subscription.name}
    >
      <BrandIcon
        iconId={subscription.iconId}
        iconKey={subscription.iconKey}
        accent={subscription.accent}
        size={25}
      />
    </button>
  );
}

export function CalendarView({ subscriptions, onSelectSubscription, initialDate }: CalendarViewProps) {
  const today = localDateKey();
  const [visibleMonth, setVisibleMonth] = useState(() => monthFromDateKey(initialDate ?? today));
  const days = useMemo(() => buildCalendarDays(visibleMonth, today), [today, visibleMonth]);
  const occurrences = useMemo(
    () => calendarOccurrencesForMonth(subscriptions, visibleMonth),
    [subscriptions, visibleMonth],
  );
  const occurrencesByDate = useMemo(() => groupCalendarOccurrences(occurrences), [occurrences]);
  const currentMonth = calendarMonthKey(visibleMonth) === today.slice(0, 7);

  return (
    <section className={styles.calendarView} aria-label="订阅日历">
      <header className={styles.calendarHeader}>
        <div className={styles.monthNavigator}>
          <button type="button" onClick={() => setVisibleMonth((month) => shiftCalendarMonth(month, -1))} aria-label="上个月">
            <ChevronLeft size={18} />
          </button>
          <div className={styles.monthLabel}>
            <h2>{calendarMonthLabel(visibleMonth)}</h2>
            <span>{occurrences.length ? `${occurrences.length} 次续费` : "暂无续费"}</span>
          </div>
          <button type="button" onClick={() => setVisibleMonth((month) => shiftCalendarMonth(month, 1))} aria-label="下个月">
            <ChevronRight size={18} />
          </button>
        </div>

        <button
          type="button"
          className={styles.todayButton}
          disabled={currentMonth}
          onClick={() => setVisibleMonth(monthFromDateKey(localDateKey()))}
        >
          今天
        </button>
      </header>

      <div className={styles.desktopCalendar}>
        <div className={styles.weekdays} aria-hidden="true">
          {weekdayLabels.map((label) => <span key={label}>{label}</span>)}
        </div>
        <div className={styles.monthGrid}>
          {days.map((day) => {
            const dayOccurrences = occurrencesByDate.get(day.date) ?? [];
            return (
              <div
                key={day.date}
                className={`${styles.calendarDay} ${day.isCurrentMonth ? "" : styles.outsideMonth} ${day.isToday ? styles.today : ""} ${dayOccurrences.length ? styles.hasEvents : ""}`}
              >
                <div className={styles.dayNumber}>
                  <time dateTime={day.date}>{day.dayOfMonth}</time>
                  {day.isToday ? <span>今天</span> : dayOccurrences.length > 1 ? <span>{dayOccurrences.length} 项</span> : null}
                </div>
                <div className={styles.dayEvents}>
                  {dayOccurrences.length === 1 ? dayOccurrences.map((occurrence) => (
                    <CalendarEvent
                      key={`${occurrence.subscription.id}:${occurrence.date}`}
                      occurrence={occurrence}
                      onSelect={onSelectSubscription}
                    />
                  )) : dayOccurrences.length > 1 ? (
                    <div className={styles.eventCluster}>
                      {dayOccurrences.map((occurrence) => (
                        <CalendarIconEvent
                          key={`${occurrence.subscription.id}:${occurrence.date}`}
                          occurrence={occurrence}
                          onSelect={onSelectSubscription}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className={styles.mobileAgenda}>
        {occurrences.length === 0 ? (
          <div className={styles.emptyAgenda}>
            <CalendarDays size={21} />
            <span>这个月没有续费</span>
          </div>
        ) : (
          Array.from(occurrencesByDate, ([date, dateOccurrences]) => (
            <section className={styles.agendaDay} key={date} aria-label={formatAgendaDate(date)}>
              <div className={styles.agendaDate}>
                <time dateTime={date}>{formatAgendaDate(date)}</time>
                {date === today && <span>今天</span>}
              </div>
              <div className={styles.agendaEvents}>
                {dateOccurrences.map((occurrence) => (
                  <CalendarEvent
                    key={`${occurrence.subscription.id}:${occurrence.date}`}
                    occurrence={occurrence}
                    onSelect={onSelectSubscription}
                    compact
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </section>
  );
}

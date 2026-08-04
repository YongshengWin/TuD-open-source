"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import {
  buildCalendarDays,
  localDateKey,
  monthFromDateKey,
  shiftCalendarMonth,
  type CalendarMonth,
} from "../../lib/subscription-calendar";

type DateFieldProps = {
  label: string;
  name: string;
  defaultValue: string;
  required?: boolean;
};

function displayDate(value: string) {
  return value.replaceAll("-", "/");
}

function safeMonth(value: string): CalendarMonth {
  try {
    return monthFromDateKey(value);
  } catch {
    return monthFromDateKey(localDateKey());
  }
}

function dayLabel(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

export function DateField({ label, name, defaultValue, required = false }: DateFieldProps) {
  const [value, setValue] = useState(defaultValue);
  const [visibleMonth, setVisibleMonth] = useState(() => safeMonth(defaultValue));
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonId = useId();
  const popoverId = useId();
  const today = localDateKey();
  const days = useMemo(() => buildCalendarDays(visibleMonth, today), [today, visibleMonth]);
  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const firstYear = Math.min(currentYear - 20, visibleMonth.year - 5);
    const lastYear = Math.max(currentYear + 50, visibleMonth.year + 5);
    return Array.from({ length: lastYear - firstYear + 1 }, (_, index) => firstYear + index);
  }, [visibleMonth.year]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [open]);

  function chooseDate(date: string) {
    setValue(date);
    setVisibleMonth(safeMonth(date));
    setOpen(false);
  }

  return (
    <div className="date-field" ref={rootRef}>
      <label htmlFor={buttonId}>{label}</label>
      <input name={name} type="hidden" value={value} required={required} />
      <button
        id={buttonId}
        className="date-field-trigger"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => {
          setVisibleMonth(safeMonth(value));
          setOpen((current) => !current);
        }}
      >
        <span>{displayDate(value)}</span>
        <CalendarDays size={17} aria-hidden="true" />
      </button>

      {open && (
        <div id={popoverId} className="date-popover" role="dialog" aria-label="选择日期">
          <div className="date-popover-head">
            <div className="date-quick-selects">
              <select aria-label="选择年份" value={visibleMonth.year} onChange={(event) => setVisibleMonth((month) => ({ ...month, year: Number(event.target.value) }))}>
                {yearOptions.map((year) => <option key={year} value={year}>{year} 年</option>)}
              </select>
              <select aria-label="选择月份" value={visibleMonth.month} onChange={(event) => setVisibleMonth((month) => ({ ...month, month: Number(event.target.value) }))}>
                {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => <option key={month} value={month}>{month} 月</option>)}
              </select>
            </div>
            <div>
              <button type="button" aria-label="上个月" onClick={() => setVisibleMonth((month) => shiftCalendarMonth(month, -1))}>
                <ChevronLeft size={17} />
              </button>
              <button type="button" aria-label="下个月" onClick={() => setVisibleMonth((month) => shiftCalendarMonth(month, 1))}>
                <ChevronRight size={17} />
              </button>
            </div>
          </div>
          <div className="date-weekdays" aria-hidden="true">
            {Array.from("一二三四五六日", (weekday) => <span key={weekday}>{weekday}</span>)}
          </div>
          <div className="date-days">
            {days.map((day) => (
              <button
                key={day.date}
                type="button"
                className={`${day.isCurrentMonth ? "" : "outside"} ${day.isToday ? "today" : ""} ${day.date === value ? "selected" : ""}`}
                aria-label={dayLabel(day.date)}
                aria-pressed={day.date === value}
                onClick={() => chooseDate(day.date)}
              >
                {day.dayOfMonth}
              </button>
            ))}
          </div>
          <div className="date-popover-foot">
            <span>{displayDate(value)}</span>
            <button type="button" onClick={() => chooseDate(today)}>回到今天</button>
          </div>
        </div>
      )}
    </div>
  );
}

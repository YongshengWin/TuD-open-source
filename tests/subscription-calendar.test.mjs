import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCalendarDays,
  calendarOccurrencesForMonth,
  daysUntilLocalDate,
  groupCalendarOccurrences,
  monthFromDateKey,
  shiftCalendarMonth,
} from "../lib/subscription-calendar.ts";

const baseSubscription = {
  id: "subscription-1",
  name: "Example",
  dueDate: "2026-01-31",
  billingCycle: "monthly",
  sortPosition: 0,
};

test("builds a Monday-first calendar grid with adjacent dates", () => {
  const days = buildCalendarDays({ year: 2026, month: 8 }, "2026-08-03");
  assert.equal(days.length, 42);
  assert.equal(days[0].date, "2026-07-27");
  assert.equal(days[6].date, "2026-08-02");
  assert.equal(days.find((day) => day.date === "2026-08-03")?.isToday, true);
  assert.equal(days.at(-1)?.date, "2026-09-06");
});

test("moves calendar months across year boundaries", () => {
  assert.deepEqual(monthFromDateKey("2026-08-03"), { year: 2026, month: 8 });
  assert.deepEqual(shiftCalendarMonth({ year: 2026, month: 1 }, -1), { year: 2025, month: 12 });
  assert.deepEqual(shiftCalendarMonth({ year: 2026, month: 12 }, 1), { year: 2027, month: 1 });
  assert.throws(() => monthFromDateKey("2026-02-31"), /格式/);
});

test("counts calendar days without a noon or DST off-by-one", () => {
  const morning = new Date(2026, 7, 3, 0, 1);
  const lateNight = new Date(2026, 7, 3, 23, 59);
  assert.equal(daysUntilLocalDate("2026-08-03", morning), 0);
  assert.equal(daysUntilLocalDate("2026-08-04", morning), 1);
  assert.equal(daysUntilLocalDate("2026-08-04", lateNight), 1);
  assert.equal(daysUntilLocalDate("2026-08-02", morning), -1);
});

test("projects recurring renewals while keeping custom dates single", () => {
  const occurrences = calendarOccurrencesForMonth([
    baseSubscription,
    { ...baseSubscription, id: "custom", name: "Domain", dueDate: "2026-03-12", billingCycle: "custom" },
    { ...baseSubscription, id: "lifetime", name: "Lifetime", dueDate: null, billingCycle: "lifetime" },
  ], { year: 2026, month: 3 });

  assert.deepEqual(occurrences.map((item) => [item.subscription.id, item.date, item.isProjected]), [
    ["custom", "2026-03-12", false],
    ["subscription-1", "2026-03-28", true],
  ]);
});

test("groups same-day subscriptions in stable custom order", () => {
  const occurrences = calendarOccurrencesForMonth([
    { ...baseSubscription, id: "later", name: "Later", dueDate: "2026-08-15", billingCycle: "custom", sortPosition: 2 },
    { ...baseSubscription, id: "first", name: "First", dueDate: "2026-08-15", billingCycle: "custom", sortPosition: 1 },
  ], { year: 2026, month: 8 });
  const grouped = groupCalendarOccurrences(occurrences);

  assert.deepEqual(grouped.get("2026-08-15")?.map((item) => item.subscription.id), ["first", "later"]);
});

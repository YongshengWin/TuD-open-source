import assert from "node:assert/strict";
import test from "node:test";
import {
  canUseSubscriptionReminders,
  dateKeyInTimeZone,
  subscriptionReminderEmails,
  subscriptionReminderDueDate,
} from "../lib/subscription-reminder.ts";

test("only the configured owner email can enable subscription reminders", () => {
  const configuredEmails = "owner@example.test, second@example.test";
  assert.equal(canUseSubscriptionReminders("owner@example.test", configuredEmails), true);
  assert.equal(canUseSubscriptionReminders(" OWNER@example.test ", configuredEmails), true);
  assert.equal(canUseSubscriptionReminders("another@example.test", configuredEmails), false);
  assert.deepEqual(subscriptionReminderEmails(" OWNER@example.test,owner@example.test "), ["owner@example.test"]);
});

test("calculates tomorrow using Asia/Shanghai instead of server timezone", () => {
  const instant = new Date("2026-08-04T16:30:00.000Z");
  assert.equal(dateKeyInTimeZone(instant), "2026-08-05");
  assert.equal(subscriptionReminderDueDate(instant), "2026-08-06");
});

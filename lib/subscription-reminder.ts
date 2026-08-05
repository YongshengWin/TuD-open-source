export function subscriptionReminderEmails(configuredEmails?: string) {
  return [...new Set((configuredEmails
    ?? process.env.SUBSCRIPTION_REMINDER_EMAILS
    ?? process.env.EMAIL_QUOTA_WHITELIST
    ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean))];
}

export function canUseSubscriptionReminders(email: string, configuredEmails?: string) {
  return subscriptionReminderEmails(configuredEmails).includes(email.trim().toLowerCase());
}

export type SubscriptionReminderUpdate = { id: string; enabled: boolean };

export function normalizeSubscriptionReminderUpdates(value: unknown, maxItems = 200): SubscriptionReminderUpdate[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { updates?: unknown }).updates)) {
    throw new Error("提醒设置格式不正确");
  }
  const updates = (value as { updates: unknown[] }).updates;
  if (updates.length > maxItems) throw new Error("一次修改的订阅过多");
  const seen = new Set<string>();
  return updates.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("提醒设置格式不正确");
    const { id, enabled } = entry as { id?: unknown; enabled?: unknown };
    if (typeof id !== "string" || !id.trim() || id.length > 100 || typeof enabled !== "boolean") {
      throw new Error("提醒设置格式不正确");
    }
    if (seen.has(id)) throw new Error("提醒设置中存在重复订阅");
    seen.add(id);
    return { id, enabled };
  });
}

export function dateKeyInTimeZone(now = new Date(), timeZone = "Asia/Shanghai") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: "year" | "month" | "day") => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function subscriptionReminderDueDate(now = new Date(), timeZone = "Asia/Shanghai") {
  const today = dateKeyInTimeZone(now, timeZone);
  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return tomorrow.toISOString().slice(0, 10);
}

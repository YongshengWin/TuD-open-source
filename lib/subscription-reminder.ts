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

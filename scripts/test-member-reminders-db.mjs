import assert from "node:assert/strict";
import postgres from "postgres";

// Run only against a local test database after migrations:
// MEMBER_REMINDER_TEST_DATABASE_URL=postgresql://...@localhost:5432/... node --import tsx --import ./tests/support/register-server-only.mjs scripts/test-member-reminders-db.mjs
const testDatabaseUrl = process.env.MEMBER_REMINDER_TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("请显式设置 MEMBER_REMINDER_TEST_DATABASE_URL 为本机测试数据库地址");
const parsedUrl = new URL(testDatabaseUrl);
if (!["postgres:", "postgresql:"].includes(parsedUrl.protocol) || !["localhost", "127.0.0.1"].includes(parsedUrl.hostname)) {
  throw new Error("成员提醒数据库测试只允许连接本机 PostgreSQL");
}
if (process.env.SMTP_HOST || process.env.NODE_ENV === "production") {
  throw new Error("成员提醒数据库测试不能连接真实邮件服务器");
}
process.env.DATABASE_URL = testDatabaseUrl;

const ownerId = crypto.randomUUID();
const outsiderId = crypto.randomUUID();
const ownerEmail = `member-reminder-owner-${ownerId}@example.test`;
const outsiderEmail = `member-reminder-outsider-${outsiderId}@example.test`;
process.env.SUBSCRIPTION_REMINDER_EMAILS = ownerEmail;

const { normalizeMemberSchedules } = await import("../lib/member-schedules.ts");
const { deliverDueSubscriptionReminders } = await import("../db/subscription-reminders.ts");
const sql = postgres(testDatabaseUrl, { max: 1, prepare: false, connect_timeout: 5 });
const now = new Date("2026-09-30T08:00:00.000Z");
const dueDate = "2026-10-01";
const laterDate = "2026-10-08";
const subscriptionIds = {
  combined: crypto.randomUUID(),
  lifetime: crypto.randomUUID(),
  archived: crypto.randomUUID(),
  disabled: crypto.randomUUID(),
  outsider: crypto.randomUUID(),
  parentOnly: crypto.randomUUID(),
};
const member = (name, reminderEnabled, nextDueDate = dueDate) => ({
  name,
  joinedDate: null,
  amountMinor: 3180,
  currencyCode: "CNY",
  nextDueDate,
  intervalCount: 2,
  intervalUnit: "month",
  reminderEnabled,
});
const schedules = (...items) => normalizeMemberSchedules(items, [], true);
const originalInfo = console.info;
const messages = [];

try {
  await sql`insert into "user" (id, name, email, email_verified) values
    (${ownerId}, 'Reminder Owner', ${ownerEmail}, true),
    (${outsiderId}, 'Reminder Outsider', ${outsiderEmail}, true)`;
  await sql`insert into subscriptions (id, user_id, name, amount_minor, currency_code, billing_cycle, due_date, reminder_enabled, member_schedules)
    values (${subscriptionIds.combined}, ${ownerId}, 'OneDrive Combined', 12000, 'CNY', 'monthly', ${dueDate}, true,
      ${sql.json(schedules(member("成员甲", true), member("成员乙", true), member("关闭提醒", false), member("下周到期", true, laterDate)))})`;
  await sql`insert into subscriptions (id, user_id, name, billing_cycle, due_date, reminder_enabled, member_schedules)
    values (${subscriptionIds.lifetime}, ${ownerId}, 'Lifetime Family', 'lifetime', null, false,
      ${sql.json(schedules(member("终身项目成员", true)))})`;
  await sql`insert into subscriptions (id, user_id, name, billing_cycle, due_date, reminder_enabled, member_schedules, is_archived)
    values (${subscriptionIds.archived}, ${ownerId}, 'Archived Family', 'lifetime', null, false,
      ${sql.json(schedules(member("已归档成员", true)))}, true)`;
  await sql`insert into subscriptions (id, user_id, name, billing_cycle, due_date, reminder_enabled, member_schedules)
    values (${subscriptionIds.disabled}, ${ownerId}, 'Disabled Family', 'lifetime', null, false,
      ${sql.json(schedules(member("未启用成员", false)))})`;
  await sql`insert into subscriptions (id, user_id, name, billing_cycle, due_date, reminder_enabled, member_schedules)
    values (${subscriptionIds.outsider}, ${outsiderId}, 'Outsider Family', 'lifetime', null, false,
      ${sql.json(schedules(member("无资格成员", true)))})`;
  await sql`insert into subscriptions (id, user_id, name, amount_minor, currency_code, billing_cycle, due_date, reminder_enabled)
    values (${subscriptionIds.parentOnly}, ${ownerId}, 'Parent Only', 5000, 'CNY', 'monthly', ${dueDate}, true)`;

  console.info = (...args) => { messages.push(args.join(" ")); };
  const first = await deliverDueSubscriptionReminders(now);
  assert.deepEqual(first, { dueDate, candidates: 3, sent: 3, failed: 0 });
  assert.equal(messages.length, 3);
  assert.ok(messages.some((messageText) => messageText.includes("OneDrive Combined 明天有 3 笔款项待处理")));
  assert.ok(messages.some((messageText) => messageText.includes("Lifetime Family 明天有 1 笔款项待处理")));
  assert.ok(messages.some((messageText) => messageText.includes("Parent Only 将于明天续费")));

  const deliveries = await sql`select subscription_id, due_date, status from subscription_reminder_deliveries
    where subscription_id = any(${Object.values(subscriptionIds)}::text[]) order by subscription_id`;
  assert.equal(deliveries.length, 3);
  assert.ok(deliveries.every((delivery) => delivery.due_date === dueDate && delivery.status === "sent"));
  assert.deepEqual(new Set(deliveries.map((delivery) => delivery.subscription_id)),
    new Set([subscriptionIds.combined, subscriptionIds.lifetime, subscriptionIds.parentOnly]));

  const second = await deliverDueSubscriptionReminders(now);
  assert.deepEqual(second, { dueDate, candidates: 3, sent: 0, failed: 0 });
  assert.equal(messages.length, 3);
  originalInfo("成员邮件数据库集成测试通过：同日合并、独立开关、终身项目、归档/名单隔离、重复运行去重");
} finally {
  console.info = originalInfo;
  await sql`delete from "user" where id in (${ownerId}, ${outsiderId})`;
  await sql.end({ timeout: 5 });
  await globalThis.nexDueSql?.end({ timeout: 5 });
}

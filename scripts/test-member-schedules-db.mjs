import assert from "node:assert/strict";
import postgres from "postgres";

// Run with an explicit local MEMBER_SCHEDULE_TEST_DATABASE_URL and:
// node --import tsx --import ./tests/support/register-server-only.mjs scripts/test-member-schedules-db.mjs

const testDatabaseUrl = process.env.MEMBER_SCHEDULE_TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("请显式设置 MEMBER_SCHEDULE_TEST_DATABASE_URL 为本机测试数据库地址");
const parsedUrl = new URL(testDatabaseUrl);
if (!["postgres:", "postgresql:"].includes(parsedUrl.protocol) || !["localhost", "127.0.0.1"].includes(parsedUrl.hostname)) {
  throw new Error("成员收款数据库测试只允许连接本机 PostgreSQL");
}
process.env.DATABASE_URL = testDatabaseUrl;

const { normalizeMemberSchedules } = await import("../lib/member-schedules.ts");
const { collectMemberPayment, listMemberPayments } = await import("../db/subscriptions.ts");
const sql = postgres(testDatabaseUrl, { max: 1, prepare: false, connect_timeout: 5 });

const ownerId = crypto.randomUUID();
const strangerId = crypto.randomUUID();
const subscriptionId = crypto.randomUUID();
const schedules = normalizeMemberSchedules([{
  name: "Fixture Member",
  joinedDate: null,
  amountMinor: 3180,
  currencyCode: "CNY",
  nextDueDate: "2028-01-31",
  intervalCount: 1,
  intervalUnit: "month",
}]);

try {
  await sql`insert into "user" (id, name, email) values
    (${ownerId}, 'Fixture Owner', ${`fixture-owner-${ownerId}@example.test`}),
    (${strangerId}, 'Fixture Stranger', ${`fixture-stranger-${strangerId}@example.test`})`;
  await sql`insert into subscriptions (id, user_id, name, member_schedules)
    values (${subscriptionId}, ${ownerId}, 'Fixture Subscription', ${sql.json(schedules)})`;

  await assert.rejects(
    collectMemberPayment(strangerId, subscriptionId, schedules[0].id, "2028-01-31"),
    /订阅不存在/,
  );
  await assert.rejects(listMemberPayments(strangerId, subscriptionId), /订阅不存在/);

  const first = await collectMemberPayment(ownerId, subscriptionId, schedules[0].id, "2028-01-31");
  assert.equal(first.payment.scheduledDueDate, "2028-01-31");
  assert.equal(first.payment.amountMinor, 3180);
  assert.equal(first.subscription.memberSchedules[0].nextDueDate, "2028-02-29");
  assert.equal(first.subscription.memberSchedules[0].anchorDay, 31);
  assert.equal(first.subscription.memberSchedules[0].lastCollectedAt, first.payment.collectedAt);
  await assert.rejects(
    collectMemberPayment(ownerId, subscriptionId, schedules[0].id, "2028-01-31"),
    /收款日期已变化/,
  );

  const second = await collectMemberPayment(ownerId, subscriptionId, schedules[0].id, "2028-02-29");
  assert.equal(second.subscription.memberSchedules[0].nextDueDate, "2028-03-31");
  assert.equal(second.payment.scheduledDueDate, "2028-02-29");

  const persisted = await sql`select member_schedules from subscriptions where id = ${subscriptionId}`;
  assert.equal(persisted[0].member_schedules[0].nextDueDate, "2028-03-31");
  const storedPayments = await sql`select count(*)::integer as count from subscription_member_payments where subscription_id = ${subscriptionId}`;
  assert.equal(storedPayments[0].count, 2);

  for (let index = 0; index < 50; index += 1) {
    await sql`insert into subscription_member_payments
      (id, subscription_id, member_id, member_name, scheduled_due_date, amount_minor, currency_code, collected_at)
      values (${crypto.randomUUID()}, ${subscriptionId}, ${schedules[0].id}, 'Fixture Member', '2027-01-01', 100, 'CNY', ${new Date(Date.UTC(2027, 0, 1))})`;
  }
  const firstPage = await listMemberPayments(ownerId, subscriptionId);
  assert.equal(firstPage.payments.length, 50);
  assert.ok(firstPage.nextCursor);
  const secondPage = await listMemberPayments(ownerId, subscriptionId, firstPage.nextCursor);
  assert.equal(secondPage.payments.length, 2);
  assert.equal(secondPage.nextCursor, null);
  assert.equal(new Set([...firstPage.payments, ...secondPage.payments].map((payment) => payment.id)).size, 52);
  await assert.rejects(listMemberPayments(ownerId, subscriptionId, "invalid-cursor"), /分页参数不正确/);
  console.info("成员收款数据库集成测试通过：权限隔离、重复收款、持久化、历史分页");
} finally {
  await sql`delete from "user" where id in (${ownerId}, ${strangerId})`;
  await sql.end({ timeout: 5 });
  await globalThis.nexDueSql?.end({ timeout: 5 });
}

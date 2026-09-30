import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";

// Opt-in HTTP integration test. Start a local TuD app connected to the same
// migrated local database, then run:
// AI_MEMBER_PAYMENT_TEST_DATABASE_URL=postgresql://...@localhost:5432/... \
// AI_MEMBER_PAYMENT_TEST_BASE_URL=http://localhost:3000 \
// node scripts/test-ai-member-payments-http.mjs

const databaseUrl = process.env.AI_MEMBER_PAYMENT_TEST_DATABASE_URL;
const baseUrl = process.env.AI_MEMBER_PAYMENT_TEST_BASE_URL;
if (!databaseUrl || !baseUrl) {
  throw new Error("请显式设置本机测试数据库和本机应用地址");
}

const database = new URL(databaseUrl);
const application = new URL(baseUrl);
const localHosts = new Set(["localhost", "127.0.0.1"]);
if (!["postgres:", "postgresql:"].includes(database.protocol) || !localHosts.has(database.hostname)) {
  throw new Error("AI 成员收款测试只允许连接本机 PostgreSQL");
}
if (application.protocol !== "http:" || !localHosts.has(application.hostname)
  || application.username || application.password || application.pathname !== "/"
  || application.search || application.hash) {
  throw new Error("AI 成员收款测试只允许请求本机 HTTP 应用根地址");
}

const sql = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 5 });
const ownerId = randomUUID();
const outsiderId = randomUUID();
const subscriptionId = randomUUID();
const memberId = randomUUID();
const ownerToken = `tud_ai_${randomBytes(32).toString("base64url")}`;
const outsiderToken = `tud_ai_${randomBytes(32).toString("base64url")}`;
const tokenHash = (token) => createHash("sha256").update(token).digest("hex");
const dueDate = "2028-01-31";
const memberSchedule = {
  id: memberId,
  name: "Fixture Member",
  joinedDate: null,
  amountMinor: 3180,
  currencyCode: "CNY",
  nextDueDate: dueDate,
  intervalCount: 1,
  intervalUnit: "month",
  reminderEnabled: false,
  anchorDay: 31,
  lastCollectedAt: null,
};

async function api(path, { token, method = "GET", body } = {}) {
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  const response = await fetch(new URL(path, application), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = await response.json();
  assert.equal(response.headers.get("cache-control"), "no-store");
  return { status: response.status, json };
}

const paymentsPath = `/api/ai/v1/subscriptions/${subscriptionId}/member-payments`;
const collectPath = `/api/ai/v1/subscriptions/${subscriptionId}/members/${memberId}/collect`;
let usersCreated = false;

try {
  await sql`insert into "user" (id, name, email, email_verified) values
    (${ownerId}, 'AI Payment Test Owner', ${`ai-payment-owner-${ownerId}@example.test`}, true),
    (${outsiderId}, 'AI Payment Test Outsider', ${`ai-payment-outsider-${outsiderId}@example.test`}, true)`;
  usersCreated = true;
  await sql`insert into ai_api_keys (id, user_id, name, token_hash, token_prefix) values
    (${randomUUID()}, ${ownerId}, 'Integration Test', ${tokenHash(ownerToken)}, ${`${ownerToken.slice(0, 14)}…`}),
    (${randomUUID()}, ${outsiderId}, 'Integration Test', ${tokenHash(outsiderToken)}, ${`${outsiderToken.slice(0, 14)}…`})`;
  await sql`insert into subscriptions (id, user_id, name, member_schedules) values
    (${subscriptionId}, ${ownerId}, 'AI Payment Test Subscription', ${sql.json([memberSchedule])})`;

  const discovery = await api("/api/ai/v1", { token: ownerToken });
  assert.equal(discovery.status, 200);
  assert.ok(discovery.json.endpoints.some((endpoint) => endpoint.method === "GET"
    && endpoint.path === "/subscriptions/{id}/member-payments"));
  assert.ok(discovery.json.endpoints.some((endpoint) => endpoint.method === "POST"
    && endpoint.path === "/subscriptions/{id}/members/{memberId}/collect"));
  assert.equal(discovery.json.accountCapabilities.memberPaymentHistory, true);
  assert.equal(discovery.json.accountCapabilities.memberPaymentCollection, true);

  const openapiResponse = await fetch(new URL("/api/ai/v1/openapi", application), { signal: AbortSignal.timeout(15_000) });
  assert.equal(openapiResponse.status, 200);
  const openapi = await openapiResponse.json();
  const paymentsOperation = openapi.paths["/subscriptions/{id}/member-payments"]?.get;
  const collectOperation = openapi.paths["/subscriptions/{id}/members/{memberId}/collect"]?.post;
  assert.equal(paymentsOperation?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref,
    "#/components/schemas/MemberPaymentPage");
  assert.equal(collectOperation?.requestBody?.content?.["application/json"]?.schema?.$ref,
    "#/components/schemas/MemberCollectRequest");
  assert.equal(collectOperation?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref,
    "#/components/schemas/MemberCollectionResult");
  assert.ok(openapi.components.schemas.MemberPaymentPage.required.includes("nextCursor"));
  assert.ok(openapi.components.schemas.MemberCollectRequest.required.includes("expectedDueDate"));
  assert.ok(openapi.components.schemas.MemberCollectionResult.required.includes("payment"));
  assert.ok(collectOperation.responses["409"]);

  assert.equal((await api(paymentsPath)).status, 401);
  assert.equal((await api(paymentsPath, { token: `tud_ai_${randomBytes(32).toString("base64url")}` })).status, 401);
  assert.equal((await api(paymentsPath, { token: outsiderToken })).status, 404);
  assert.equal((await api(collectPath, { token: outsiderToken, method: "POST", body: { expectedDueDate: dueDate } })).status, 404);

  const initial = await api(paymentsPath, { token: ownerToken });
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.json, { payments: [], nextCursor: null });
  assert.equal((await api(collectPath, { token: ownerToken, method: "POST", body: { expectedDueDate: "not-a-date" } })).status, 400);

  const collected = await api(collectPath, { token: ownerToken, method: "POST", body: { expectedDueDate: dueDate } });
  assert.equal(collected.status, 200);
  assert.equal(collected.json.payment.scheduledDueDate, dueDate);
  assert.equal(collected.json.payment.amountMinor, 3180);
  assert.equal(collected.json.subscription.memberSchedules[0].nextDueDate, "2028-02-29");
  assert.ok(collected.json.subscription.memberSchedules[0].lastCollectedAt);

  const staleRetry = await api(collectPath, { token: ownerToken, method: "POST", body: { expectedDueDate: dueDate } });
  assert.equal(staleRetry.status, 409);
  assert.equal(staleRetry.json.error, "conflict");
  const afterRetry = await sql`select member_schedules from subscriptions where id = ${subscriptionId}`;
  assert.equal(afterRetry[0].member_schedules[0].nextDueDate, "2028-02-29");
  const afterRetryPayments = await sql`select count(*)::integer as count from subscription_member_payments where subscription_id = ${subscriptionId}`;
  assert.equal(afterRetryPayments[0].count, 1);

  const futureCollectedAt = new Date(Date.now() + 86_400_000);
  for (let index = 0; index < 50; index += 1) {
    await sql`insert into subscription_member_payments
      (id, subscription_id, member_id, member_name, scheduled_due_date, amount_minor, currency_code, collected_at)
      values (${randomUUID()}, ${subscriptionId}, ${memberId}, 'Fixture Member', '2027-01-01', 100, 'CNY', ${futureCollectedAt})`;
  }

  const firstPage = await api(paymentsPath, { token: ownerToken });
  assert.equal(firstPage.status, 200);
  assert.equal(firstPage.json.payments.length, 50);
  assert.equal(typeof firstPage.json.nextCursor, "string");
  const secondPage = await api(`${paymentsPath}?cursor=${encodeURIComponent(firstPage.json.nextCursor)}`, { token: ownerToken });
  assert.equal(secondPage.status, 200);
  assert.equal(secondPage.json.payments.length, 1);
  assert.equal(secondPage.json.nextCursor, null);
  assert.equal(new Set([...firstPage.json.payments, ...secondPage.json.payments].map((payment) => payment.id)).size, 51);
  const invalidCursor = await api(`${paymentsPath}?cursor=invalid-cursor`, { token: ownerToken });
  assert.equal(invalidCursor.status, 400);
  assert.equal(invalidCursor.json.error, "invalid_request");
  assert.equal((await api(`${paymentsPath}?cursor=`, { token: ownerToken })).status, 400);

  console.info("AI 成员收款 HTTP 集成测试通过：发现文档、密钥鉴权、用户隔离、收款推进、重复请求、历史分页");
} finally {
  try {
    if (usersCreated) await sql`delete from "user" where id in (${ownerId}, ${outsiderId})`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

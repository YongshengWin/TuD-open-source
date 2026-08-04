import "server-only";
import { sql } from "drizzle-orm";
import { db } from "../db";

const DEFAULT_DAILY_LIMIT = 100;
const DEFAULT_RECIPIENT_LIMIT = 3;

export const EMAIL_QUOTA_EXHAUSTED_CODE = "EMAIL_DAILY_QUOTA_EXHAUSTED";
export const EMAIL_RECIPIENT_LIMIT_CODE = "EMAIL_RECIPIENT_DAILY_LIMIT";

type QuotaFailure = typeof EMAIL_QUOTA_EXHAUSTED_CODE | typeof EMAIL_RECIPIENT_LIMIT_CODE;

export class EmailQuotaError extends Error {
  constructor(public readonly code: QuotaFailure, message: string) {
    super(message);
    this.name = "EmailQuotaError";
  }
}

function positiveLimit(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function quotaPolicy() {
  return {
    dailyLimit: positiveLimit(process.env.EMAIL_DAILY_LIMIT, DEFAULT_DAILY_LIMIT),
    recipientLimit: positiveLimit(process.env.EMAIL_RECIPIENT_DAILY_LIMIT, DEFAULT_RECIPIENT_LIMIT),
    whitelist: new Set((process.env.EMAIL_QUOTA_WHITELIST ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)),
  };
}

function utcDay(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function nextUtcDay(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

type CountRow = { total_count: number; recipient_count: number };

async function countsForDay(day: string, recipientEmail?: string) {
  const result = await db.execute<CountRow>(sql`
    SELECT
      COALESCE(SUM(delivery_count), 0)::int AS total_count,
      COALESCE(MAX(delivery_count) FILTER (WHERE recipient_email = ${recipientEmail ?? ""}), 0)::int AS recipient_count
    FROM email_delivery_daily
    WHERE delivery_day = ${day}
  `);
  return result[0] ?? { total_count: 0, recipient_count: 0 };
}

function assertCountsAvailable(total: number, recipientCount: number, email: string) {
  const policy = quotaPolicy();
  if (total >= policy.dailyLimit) {
    throw new EmailQuotaError(EMAIL_QUOTA_EXHAUSTED_CODE, "今日邮件额度已用尽，注册和找回密码将在明日恢复");
  }
  if (!policy.whitelist.has(email) && recipientCount >= policy.recipientLimit) {
    throw new EmailQuotaError(EMAIL_RECIPIENT_LIMIT_CODE, `该邮箱今日最多接收 ${policy.recipientLimit} 封验证邮件，请明日再试`);
  }
}

export async function getEmailQuotaStatus() {
  const now = new Date();
  const day = utcDay(now);
  const { dailyLimit } = quotaPolicy();
  const counts = await countsForDay(day);
  return {
    available: counts.total_count < dailyLimit,
    resetsAt: nextUtcDay(now),
  };
}

export async function assertAuthEmailAvailable(email: string) {
  const normalized = normalizeEmail(email);
  const counts = await countsForDay(utcDay(), normalized);
  assertCountsAvailable(counts.total_count, counts.recipient_count, normalized);
}

export async function reserveAuthEmail(email: string) {
  const normalized = normalizeEmail(email);
  const day = utcDay();
  await db.transaction(async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`tud-email-quota:${day}`}))`);
    const result = await transaction.execute<CountRow>(sql`
      SELECT
        COALESCE(SUM(delivery_count), 0)::int AS total_count,
        COALESCE(MAX(delivery_count) FILTER (WHERE recipient_email = ${normalized}), 0)::int AS recipient_count
      FROM email_delivery_daily
      WHERE delivery_day = ${day}
    `);
    const counts = result[0] ?? { total_count: 0, recipient_count: 0 };
    assertCountsAvailable(counts.total_count, counts.recipient_count, normalized);
    await transaction.execute(sql`
      INSERT INTO email_delivery_daily (delivery_day, recipient_email, delivery_count, updated_at)
      VALUES (${day}, ${normalized}, 1, now())
      ON CONFLICT (delivery_day, recipient_email)
      DO UPDATE SET delivery_count = email_delivery_daily.delivery_count + 1, updated_at = now()
    `);
  });
  return { day, email: normalized };
}

export async function releaseAuthEmail(reservation: { day: string; email: string }) {
  await db.transaction(async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`tud-email-quota:${reservation.day}`}))`);
    await transaction.execute(sql`
      UPDATE email_delivery_daily
      SET delivery_count = GREATEST(delivery_count - 1, 0), updated_at = now()
      WHERE delivery_day = ${reservation.day} AND recipient_email = ${reservation.email}
    `);
    await transaction.execute(sql`
      DELETE FROM email_delivery_daily
      WHERE delivery_day = ${reservation.day} AND recipient_email = ${reservation.email} AND delivery_count = 0
    `);
  });
}

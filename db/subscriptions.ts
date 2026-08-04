import "server-only";
import { and, asc, count, eq, inArray, max, sql } from "drizzle-orm";
import {
  addBillingCycle,
  isBillingCycle,
  isSupportedCurrency,
} from "../lib/subscription-options";
import { normalizeBrandSelection } from "../lib/brand-catalog.server";
import { normalizeSubscriptionCardAccent } from "../lib/subscription-card-accent";
import { assertCompleteSubscriptionOrder, MAX_ORDERED_SUBSCRIPTIONS, normalizeSubscriptionOrder } from "../lib/subscription-order";
import { db } from "./index";
import { subscriptionCategories, subscriptions } from "./schema";

export type SubscriptionRecord = typeof subscriptions.$inferSelect;

export type SubscriptionWriteInput = {
  name?: unknown;
  iconId?: unknown;
  iconKey?: unknown;
  groupName?: unknown;
  amountMinor?: unknown;
  currencyCode?: unknown;
  billingCycle?: unknown;
  dueDate?: unknown;
  accent?: unknown;
  cardAccent?: unknown;
  accountName?: unknown;
  website?: unknown;
  notes?: unknown;
  reminderEnabled?: unknown;
};

function normalizeText(value: unknown, fallback: string, maxLength: number) {
  const normalized = typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
  return normalized || fallback;
}

function normalizeDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("请选择有效日期");
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("日期格式不正确");
  return value;
}

function normalizeWebsite(value: unknown) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error("官网地址不正确");
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    return url.toString().slice(0, 500);
  } catch {
    throw new Error("官网地址必须以 http:// 或 https:// 开头");
  }
}

function normalizeAccountName(value: unknown) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error("账号格式不正确");
  const normalized = value.trim().replace(/\s+/g, " ").slice(0, 160);
  return normalized || null;
}

async function normalizeSubscriptionInput(input: SubscriptionWriteInput, allowReminder = false) {
  const name = normalizeText(input.name, "", 80);
  if (!name) throw new Error("请输入服务名称");

  const groupName = normalizeText(input.groupName, "其他", 30);
  const currencyCode = typeof input.currencyCode === "string" ? input.currencyCode.toUpperCase() : "CNY";
  if (!isSupportedCurrency(currencyCode)) throw new Error("暂不支持该币种");

  const billingCycle = typeof input.billingCycle === "string" ? input.billingCycle : "monthly";
  if (!isBillingCycle(billingCycle)) throw new Error("订阅周期不正确");

  const rawAmount = input.amountMinor;
  const amountMinor = rawAmount == null || rawAmount === "" ? null : Number(rawAmount);
  if (amountMinor != null && (!Number.isSafeInteger(amountMinor) || amountMinor < 0)) throw new Error("金额不正确");

  const dueDate = billingCycle === "lifetime" ? null : normalizeDate(input.dueDate);
  const brand = await normalizeBrandSelection(input.iconId, input.iconKey);
  const notes = typeof input.notes === "string" ? input.notes.trim().slice(0, 1000) : "";

  return {
    name,
    ...brand,
    groupName,
    amountMinor,
    currencyCode,
    billingCycle,
    dueDate,
    cardAccent: normalizeSubscriptionCardAccent(input.cardAccent),
    accountName: normalizeAccountName(input.accountName),
    website: normalizeWebsite(input.website),
    notes,
    reminderEnabled: allowReminder && billingCycle !== "lifetime" && input.reminderEnabled === true,
  };
}

export async function listSubscriptions(userId: string): Promise<SubscriptionRecord[]> {
  return db.select().from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.isArchived, false)))
    .orderBy(asc(subscriptions.sortPosition), asc(subscriptions.createdAt), asc(subscriptions.id));
}

export async function listSubscriptionsByStatus(userId: string, status: "active" | "archived" | "all" = "active"): Promise<SubscriptionRecord[]> {
  if (status === "active") return listSubscriptions(userId);
  return db.select().from(subscriptions)
    .where(status === "archived"
      ? and(eq(subscriptions.userId, userId), eq(subscriptions.isArchived, true))
      : eq(subscriptions.userId, userId))
    .orderBy(asc(subscriptions.isArchived), asc(subscriptions.sortPosition), asc(subscriptions.createdAt), asc(subscriptions.id));
}

export async function getSubscription(userId: string, id: string) {
  const [record] = await db.select().from(subscriptions)
    .where(and(eq(subscriptions.id, id), eq(subscriptions.userId, userId), eq(subscriptions.isArchived, false)))
    .limit(1);
  return record ?? null;
}

export async function getSubscriptionIncludingArchived(userId: string, id: string) {
  const [record] = await db.select().from(subscriptions)
    .where(and(eq(subscriptions.id, id), eq(subscriptions.userId, userId)))
    .limit(1);
  return record ?? null;
}

export async function createSubscription(userId: string, input: SubscriptionWriteInput, allowReminder = false) {
  const values = await normalizeSubscriptionInput(input, allowReminder);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`nexdue:subscriptions:${userId}`}, 0))`);
    await tx.insert(subscriptionCategories).values({
      id: crypto.randomUUID(),
      userId,
      name: values.groupName,
      sortPosition: sql`coalesce((select max(sc.sort_position) + 1 from subscription_categories sc where sc.user_id = ${userId}), 0)`,
    }).onConflictDoNothing();
    const [activeCount] = await tx.select({ value: count() })
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, userId), eq(subscriptions.isArchived, false)));
    if ((activeCount?.value ?? 0) >= MAX_ORDERED_SUBSCRIPTIONS) {
      throw new Error(`每个账号最多可管理 ${MAX_ORDERED_SUBSCRIPTIONS} 个有效订阅`);
    }
    const [lastPosition] = await tx.select({ value: max(subscriptions.sortPosition) })
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, userId), eq(subscriptions.isArchived, false)));
    const [created] = await tx.insert(subscriptions).values({
      id: crypto.randomUUID(),
      userId,
      sortPosition: (lastPosition?.value ?? -1) + 1,
      ...values,
    }).returning();
    return created;
  });
}

export async function reorderSubscriptions(userId: string, value: unknown) {
  const orderedIds = normalizeSubscriptionOrder(value);

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`nexdue:subscriptions:${userId}`}, 0))`);
    const current = await tx.select({ id: subscriptions.id })
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, userId), eq(subscriptions.isArchived, false)))
      .orderBy(asc(subscriptions.id))
      .for("update");

    assertCompleteSubscriptionOrder(orderedIds, current.map((item) => item.id));
    if (orderedIds.length === 0) return [];

    const cases = sql.join(
      orderedIds.map((id, position) => sql`when ${subscriptions.id} = ${id} then ${position}`),
      sql.raw(" "),
    );
    await tx.update(subscriptions)
      .set({
        sortPosition: sql`case ${cases} else ${subscriptions.sortPosition} end`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(subscriptions.userId, userId),
        eq(subscriptions.isArchived, false),
        inArray(subscriptions.id, orderedIds),
      ));

    return orderedIds;
  });
}

export async function updateSubscription(userId: string, id: string, input: SubscriptionWriteInput, allowReminder = false) {
  const current = await getSubscription(userId, id);
  if (!current) throw new Error("订阅不存在");
  const values = await normalizeSubscriptionInput({ ...current, ...input }, allowReminder);

  return db.transaction(async (tx) => {
    await tx.insert(subscriptionCategories).values({
      id: crypto.randomUUID(),
      userId,
      name: values.groupName,
      sortPosition: sql`coalesce((select max(sc.sort_position) + 1 from subscription_categories sc where sc.user_id = ${userId}), 0)`,
    }).onConflictDoNothing();
    const [updated] = await tx.update(subscriptions)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(subscriptions.id, id), eq(subscriptions.userId, userId), eq(subscriptions.isArchived, false)))
      .returning();
    if (!updated) throw new Error("订阅不存在");
    return updated;
  });
}

export async function renewSubscription(userId: string, id: string) {
  const current = await getSubscription(userId, id);
  if (!current) throw new Error("订阅不存在");
  if (!current.dueDate) throw new Error("永久有效订阅无需续费");
  const nextDate = addBillingCycle(current.dueDate, current.billingCycle);
  const [updated] = await db.update(subscriptions)
    .set({ dueDate: nextDate, updatedAt: new Date() })
    .where(and(eq(subscriptions.id, id), eq(subscriptions.userId, userId), eq(subscriptions.isArchived, false)))
    .returning();
  if (!updated) throw new Error("订阅不存在");
  return updated;
}

export async function archiveSubscription(userId: string, id: string) {
  const [archived] = await db.update(subscriptions)
    .set({ isArchived: true, reminderEnabled: false, updatedAt: new Date() })
    .where(and(eq(subscriptions.id, id), eq(subscriptions.userId, userId), eq(subscriptions.isArchived, false)))
    .returning();
  if (!archived) throw new Error("订阅不存在或已归档");
  return archived;
}

export async function restoreSubscription(userId: string, id: string) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`nexdue:subscriptions:${userId}`}, 0))`);
    const [activeCount] = await tx.select({ value: count() })
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, userId), eq(subscriptions.isArchived, false)));
    if ((activeCount?.value ?? 0) >= MAX_ORDERED_SUBSCRIPTIONS) {
      throw new Error(`每个账号最多可管理 ${MAX_ORDERED_SUBSCRIPTIONS} 个有效订阅`);
    }
    const [lastPosition] = await tx.select({ value: max(subscriptions.sortPosition) })
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, userId), eq(subscriptions.isArchived, false)));
    const [restored] = await tx.update(subscriptions)
      .set({ isArchived: false, sortPosition: (lastPosition?.value ?? -1) + 1, updatedAt: new Date() })
      .where(and(eq(subscriptions.id, id), eq(subscriptions.userId, userId), eq(subscriptions.isArchived, true)))
      .returning();
    if (!restored) throw new Error("订阅不存在或未归档");
    return restored;
  });
}

export async function permanentlyDeleteSubscription(userId: string, id: string) {
  const [deleted] = await db.delete(subscriptions)
    .where(and(eq(subscriptions.id, id), eq(subscriptions.userId, userId)))
    .returning({ id: subscriptions.id, name: subscriptions.name });
  if (!deleted) throw new Error("订阅不存在");
  return deleted;
}

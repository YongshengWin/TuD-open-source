import "server-only";
import { and, asc, eq, inArray, max, sql } from "drizzle-orm";
import { db } from "./index";
import { subscriptionCategories, subscriptions } from "./schema";

function normalizeCategoryName(rawName: unknown) {
  const name = typeof rawName === "string" ? rawName.trim().replace(/\s+/g, " ").slice(0, 30) : "";
  if (!name) throw new Error("请输入分类名称");
  return name;
}

export async function listCategories(userId: string) {
  return db.select({ name: subscriptionCategories.name })
    .from(subscriptionCategories)
    .where(eq(subscriptionCategories.userId, userId))
    .orderBy(asc(subscriptionCategories.sortPosition), asc(subscriptionCategories.createdAt), asc(subscriptionCategories.id));
}

export async function createCategory(userId: string, rawName: unknown) {
  const name = normalizeCategoryName(rawName);
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`tud:categories:${userId}`}, 0))`);
    const [lastPosition] = await tx.select({ value: max(subscriptionCategories.sortPosition) })
      .from(subscriptionCategories)
      .where(eq(subscriptionCategories.userId, userId));
    await tx.insert(subscriptionCategories).values({
      id: crypto.randomUUID(),
      userId,
      name,
      sortPosition: (lastPosition?.value ?? -1) + 1,
    }).onConflictDoNothing();
  });
  return name;
}

export async function reorderCategories(userId: string, rawNames: unknown) {
  if (!Array.isArray(rawNames) || rawNames.length > 100) throw new Error("分类顺序不正确");
  const orderedNames = rawNames.map(normalizeCategoryName);
  if (new Set(orderedNames).size !== orderedNames.length) throw new Error("分类顺序包含重复项");

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`tud:categories:${userId}`}, 0))`);
    const current = await tx.select({ name: subscriptionCategories.name })
      .from(subscriptionCategories)
      .where(eq(subscriptionCategories.userId, userId))
      .for("update");
    const currentNames = current.map((item) => item.name);
    if (orderedNames.length !== currentNames.length || orderedNames.some((name) => !currentNames.includes(name))) {
      throw new Error("分类列表已变化，请刷新后重试");
    }
    if (orderedNames.length === 0) return [];

    const cases = sql.join(
      orderedNames.map((name, position) => sql`when ${subscriptionCategories.name} = ${name} then ${position}`),
      sql.raw(" "),
    );
    await tx.update(subscriptionCategories)
      .set({ sortPosition: sql`case ${cases} else ${subscriptionCategories.sortPosition} end` })
      .where(and(eq(subscriptionCategories.userId, userId), inArray(subscriptionCategories.name, orderedNames)));
    return orderedNames;
  });
}

export async function deleteCategory(userId: string, rawName: unknown, rawReplacement: unknown) {
  const name = normalizeCategoryName(rawName);
  if (name === "其他") throw new Error("“其他”是默认分类，不能删除");
  const replacement = normalizeCategoryName(rawReplacement ?? "其他");
  if (replacement === name) throw new Error("请选择不同的迁移分类");

  return db.transaction(async (tx) => {
    const [category] = await tx.select({ id: subscriptionCategories.id })
      .from(subscriptionCategories)
      .where(and(eq(subscriptionCategories.userId, userId), eq(subscriptionCategories.name, name)))
      .limit(1);
    const affected = await tx.select({ id: subscriptions.id })
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, userId), eq(subscriptions.groupName, name)));
    if (!category && affected.length === 0) throw new Error("分类不存在");

    if (affected.length > 0) {
      await tx.insert(subscriptionCategories).values({
        id: crypto.randomUUID(),
        userId,
        name: replacement,
        sortPosition: sql`coalesce((select max(sc.sort_position) + 1 from subscription_categories sc where sc.user_id = ${userId}), 0)`,
      }).onConflictDoNothing();
      await tx.update(subscriptions)
        .set({ groupName: replacement, updatedAt: new Date() })
        .where(and(eq(subscriptions.userId, userId), eq(subscriptions.groupName, name)));
    }

    await tx.delete(subscriptionCategories)
      .where(and(eq(subscriptionCategories.userId, userId), eq(subscriptionCategories.name, name)));
    return { name, moved: affected.length, replacement: affected.length > 0 ? replacement : null };
  });
}

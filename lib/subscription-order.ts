export const MAX_ORDERED_SUBSCRIPTIONS = 2_000;

export class SubscriptionOrderValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubscriptionOrderValidationError";
  }
}

export function normalizeSubscriptionOrder(value: unknown) {
  if (!Array.isArray(value)) throw new SubscriptionOrderValidationError("订阅顺序格式不正确");
  if (value.length > MAX_ORDERED_SUBSCRIPTIONS) throw new SubscriptionOrderValidationError("订阅数量超出排序上限");

  const ids = value.map((id) => {
    if (typeof id !== "string" || id.length === 0 || id.length > 128 || id.trim() !== id) {
      throw new SubscriptionOrderValidationError("订阅顺序包含无效 ID");
    }
    return id;
  });
  if (new Set(ids).size !== ids.length) throw new SubscriptionOrderValidationError("订阅顺序不能包含重复项目");
  return ids;
}

export function assertCompleteSubscriptionOrder(orderedIds: readonly string[], existingIds: readonly string[]) {
  if (orderedIds.length !== existingIds.length) throw new SubscriptionOrderValidationError("请提交全部订阅的完整顺序");
  const existing = new Set(existingIds);
  if (orderedIds.some((id) => !existing.has(id))) throw new SubscriptionOrderValidationError("订阅顺序包含无权访问或不存在的项目");
}

export function groupSubscriptionsByCategory<T extends { groupName: string; sortPosition: number }>(
  items: readonly T[],
  categoryOrder: readonly string[],
) {
  const rank = new Map(categoryOrder.map((name, index) => [name, index]));
  return items.map((item, originalIndex) => ({ item, originalIndex })).sort((left, right) => {
    const leftRank = rank.get(left.item.groupName) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = rank.get(right.item.groupName) ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank
      || left.item.groupName.localeCompare(right.item.groupName, "zh-CN")
      || left.item.sortPosition - right.item.sortPosition
      || left.originalIndex - right.originalIndex;
  }).map(({ item }) => item);
}

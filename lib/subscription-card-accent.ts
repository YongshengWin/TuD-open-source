const CARD_ACCENT_PATTERN = /^#?([0-9a-f]{6})$/i;

export function normalizeSubscriptionCardAccent(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error("卡片颜色格式不正确");

  const match = value.trim().match(CARD_ACCENT_PATTERN);
  if (!match) throw new Error("卡片颜色格式不正确");
  return match[1].toLowerCase();
}

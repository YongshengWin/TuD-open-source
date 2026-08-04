import "server-only";
import type { SubscriptionRecord, SubscriptionWriteInput } from "../db/subscriptions";
import { assertAiSubscriptionFields } from "./ai-api-contract";
import { majorToMinor } from "./subscription-options";

export function aiJson(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(data, { ...init, headers });
}

export function publicAiApiOrigin(request: Request) {
  const configuredOrigin = process.env.TUD_PUBLIC_URL?.trim() || process.env.BETTER_AUTH_URL?.trim();
  if (configuredOrigin) {
    try {
      return new URL(configuredOrigin).origin;
    } catch {
      // Production preflight validates this value; retain a safe request fallback for development.
    }
  }
  return new URL(request.url).origin;
}

export async function readAiJson(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > 64 * 1024) throw new Error("请求内容过大");
  const text = await request.text();
  if (text.length > 64 * 1024) throw new Error("请求内容过大");
  if (!text) return {};
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new Error("请求必须是有效的 JSON");
  }
}

export function subscriptionInputFromAi(input: Record<string, unknown>, fallbackCurrency = "CNY"): SubscriptionWriteInput {
  assertAiSubscriptionFields(input);
  if (input.amount !== undefined && input.amountMinor !== undefined) throw new Error("amount 与 amountMinor 只能提供一个");
  if (input.amount !== undefined) {
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount < 0) throw new Error("amount 必须是非负数字");
    const currency = typeof input.currencyCode === "string" ? input.currencyCode.toUpperCase() : fallbackCurrency;
    return { ...input, amountMinor: majorToMinor(amount, currency) };
  }
  return input;
}

export function publicSubscription(item: SubscriptionRecord) {
  return {
    id: item.id,
    name: item.name,
    groupName: item.groupName,
    amountMinor: item.amountMinor,
    currencyCode: item.currencyCode,
    billingCycle: item.billingCycle,
    dueDate: item.dueDate,
    accountName: item.accountName,
    website: item.website,
    notes: item.notes,
    reminderEnabled: item.reminderEnabled,
    iconId: item.iconId,
    cardAccent: item.cardAccent,
    accent: item.accent,
    sortPosition: item.sortPosition,
    isArchived: item.isArchived,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function unauthorizedAiResponse() {
  return aiJson({
    error: "invalid_api_key",
    message: "请使用 Authorization: Bearer tud_ai_... 提供有效的 TuD AI Key。",
  }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
}

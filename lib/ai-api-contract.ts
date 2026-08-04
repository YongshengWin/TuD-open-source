import { billingCycleOptions, currencyOptions } from "./subscription-options";

export const aiBillingCycles = billingCycleOptions.map((option) => option.value);
export const aiCurrencies = currencyOptions.map((option) => option.value);

export const aiSubscriptionWritableFields = [
  "name",
  "iconId",
  "groupName",
  "amount",
  "amountMinor",
  "currencyCode",
  "billingCycle",
  "dueDate",
  "cardAccent",
  "accountName",
  "website",
  "notes",
  "reminderEnabled",
] as const;

const writableFieldSet = new Set<string>(aiSubscriptionWritableFields);

export function assertAiSubscriptionFields(input: Record<string, unknown>) {
  const unknown = Object.keys(input).filter((key) => !writableFieldSet.has(key));
  if (unknown.length) throw new Error(`不支持的字段：${unknown.join("、")}`);
}

export function parseSubscriptionStatus(value: string | null): "active" | "archived" | "all" {
  if (!value || value === "active") return "active";
  if (value === "archived" || value === "all") return value;
  throw new Error("status 只能是 active、archived 或 all");
}

export const aiWriteConfirmationRule = "创建、更新、续费、排序、归档、恢复、永久删除、分类管理、图标发现或偏好修改前，必须复述具体变更并获得用户明确确认。";

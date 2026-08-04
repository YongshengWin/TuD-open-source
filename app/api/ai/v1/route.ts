import { authorizeAiRequest } from "../../../../lib/ai-api-auth.server";
import { aiJson, publicAiApiOrigin, unauthorizedAiResponse } from "../../../../lib/ai-api.server";
import { currencyOptions } from "../../../../lib/subscription-options";
import { aiBillingCycles, aiSubscriptionWritableFields, aiWriteConfirmationRule } from "../../../../lib/ai-api-contract";
import { canUseSubscriptionReminders } from "../../../../lib/subscription-reminder";
import { getUserSummaryCurrency } from "../../../../db/users";

export async function GET(request: Request) {
  const identity = await authorizeAiRequest(request);
  if (!identity) return unauthorizedAiResponse();
  const baseUrl = publicAiApiOrigin(request);
  const summaryCurrency = await getUserSummaryCurrency(identity.userId);
  return aiJson({
    name: "TuD AI API",
    version: "v1",
    baseUrl: `${baseUrl}/api/ai/v1`,
    authentication: "Authorization: Bearer <TUD_AI_KEY>",
    endpoints: [
      { method: "GET", path: "/subscriptions", purpose: "列出订阅" },
      { method: "POST", path: "/subscriptions", purpose: "创建订阅" },
      { method: "GET", path: "/subscriptions/{id}", purpose: "读取订阅" },
      { method: "PATCH", path: "/subscriptions/{id}", purpose: "更新订阅" },
      { method: "POST", path: "/subscriptions/{id}/renew", purpose: "将续费日期推进一个周期" },
      { method: "DELETE", path: "/subscriptions/{id}", purpose: "归档订阅；永久删除需 permanent=true 且 confirm={id}" },
      { method: "POST", path: "/subscriptions/{id}/restore", purpose: "恢复已归档订阅" },
      { method: "PATCH", path: "/subscriptions/order", purpose: "调整有效订阅顺序" },
      { method: "GET/POST/PATCH/DELETE", path: "/categories", purpose: "查询、创建、排序和删除分类" },
      { method: "GET", path: "/icons?q=", purpose: "搜索可用图标并取得 iconId" },
      { method: "POST", path: "/icons/discover", purpose: "从官方网站发现并缓存图标" },
      { method: "POST", path: "/icons/monogram", purpose: "创建最多 5 个字符的字母图标" },
      { method: "GET/PATCH", path: "/preferences", purpose: "读取能力与汇总币种、修改汇总币种" },
      { method: "POST", path: "/ticket", purpose: "默认生成 PNG 订阅票；format=json 返回结构化数据" },
      { method: "GET", path: "/openapi", purpose: "读取无需鉴权的 OpenAPI 3.1 说明" },
    ],
    writeFields: {
      requiredForCreate: ["name", "iconId", "dueDate unless billingCycle is lifetime"],
      optional: aiSubscriptionWritableFields.filter((field) => !["name", "iconId", "dueDate"].includes(field)),
      notes: [
        "amount 使用币种主单位，例如 12.99；amountMinor 使用最小单位，二者不要同时提供。",
        "billingCycle 可用 monthly、quarterly、semiannual、yearly、biennial、triennial、custom、lifetime。",
        "lifetime 无需 dueDate；其他周期的 dueDate 使用 YYYY-MM-DD。",
        "创建前先通过 /icons 搜索 iconId；无结果时使用 /icons/discover 或 /icons/monogram。",
        aiWriteConfirmationRule,
      ],
    },
    fieldReference: {
      name: { type: "string", requiredOnCreate: true, maxLength: 80, description: "服务名称" },
      iconId: { type: "string", requiredOnCreate: true, description: "通过图标搜索、官网发现或字母图标接口取得" },
      groupName: { type: "string", default: "其他", maxLength: 30, description: "用户自定义分类；不存在时自动创建" },
      amount: { type: "number", minimum: 0, description: "币种主单位金额，例如 12.99；不能与 amountMinor 同时提供" },
      amountMinor: { type: "integer|null", minimum: 0, description: "币种最小单位金额；不能与 amount 同时提供" },
      currencyCode: { type: "ISO 4217 string", default: "CNY" },
      billingCycle: { type: "enum", default: "monthly", values: aiBillingCycles },
      dueDate: { type: "YYYY-MM-DD|null", description: "除 lifetime 外必填" },
      accountName: { type: "string|null", maxLength: 160 },
      website: { type: "http(s) URL|null", maxLength: 500 },
      notes: { type: "string", maxLength: 1000 },
      reminderEnabled: { type: "boolean", description: "仅对有提醒资格的账户生效" },
      cardAccent: { type: "hex color|null", example: "2563eb", description: "卡片自定义颜色；null 表示跟随图标" },
    },
    examples: {
      createSubscription: {
        method: "POST",
        path: "/subscriptions",
        prerequisite: "先调用 GET /icons?q=Claude 并选择返回的 iconId",
        body: { name: "Claude Pro", iconId: "lobe-icons:claude", groupName: "AI 工具", amount: 20, currencyCode: "USD", billingCycle: "monthly", dueDate: "2026-09-12", website: "https://claude.ai" },
      },
      updateSubscription: {
        method: "PATCH",
        path: "/subscriptions/{id}",
        body: { amount: 25, currencyCode: "USD", dueDate: "2026-10-12", notes: "已升级套餐" },
      },
      renewSubscription: { method: "POST", path: "/subscriptions/{id}/renew", body: null },
      createTicket: { method: "POST", path: "/ticket", body: { selectedIds: ["subscription-id-1", "subscription-id-2"], summaryCurrency: "CNY" } },
    },
    accountCapabilities: {
      reminderEligible: canUseSubscriptionReminders(identity.email),
      summaryCurrency,
      permanentDeletion: true,
      iconDiscovery: true,
      monogramIcons: true,
      pngSubscriptionTickets: true,
    },
    limitations: ["单张 PNG 订阅票最多展示 100 项订阅。", "每把 Key 只能访问创建它的用户数据。"],
    supportedCurrencies: currencyOptions.map((option) => option.value),
  });
}

import { aiBillingCycles, aiCurrencies, aiWriteConfirmationRule } from "../../../../../lib/ai-api-contract";
import { publicAiApiOrigin } from "../../../../../lib/ai-api.server";

const errorResponse = (description: string) => ({ description, content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } });
const jsonBody = (schema: object, example?: object) => ({ required: true, content: { "application/json": { schema, ...(example ? { example } : {}) } } });
const idParameter = { name: "id", in: "path", required: true, schema: { type: "string" }, description: "必须先从列表接口取得真实 ID，不要猜测" };

export async function GET(request: Request) {
  const origin = publicAiApiOrigin(request);
  const writableProperties = {
    name: { type: "string", maxLength: 80, description: "服务名称" },
    iconId: { type: "string", maxLength: 260, description: "必填；通过 /icons、/icons/discover 或 /icons/monogram 取得" },
    groupName: { type: "string", maxLength: 30, default: "其他", description: "用户自定义分类；不存在时自动创建" },
    amount: { type: "number", minimum: 0, description: "币种主单位金额；不能与 amountMinor 同时发送" },
    amountMinor: { type: ["integer", "null"], minimum: 0, description: "币种最小单位金额；不能与 amount 同时发送" },
    currencyCode: { type: "string", enum: aiCurrencies, default: "CNY" },
    billingCycle: { type: "string", enum: aiBillingCycles, default: "monthly" },
    dueDate: { type: ["string", "null"], format: "date", description: "除 lifetime 外必填，格式 YYYY-MM-DD" },
    cardAccent: { type: ["string", "null"], pattern: "^#?[0-9a-fA-F]{6}$", description: "卡片颜色；null 表示跟随图标" },
    accountName: { type: ["string", "null"], maxLength: 160, description: "账号、用户名或会员号；不要保存密码" },
    website: { type: ["string", "null"], format: "uri", maxLength: 500 },
    notes: { type: "string", maxLength: 1000 },
    reminderEnabled: { type: "boolean", description: "仅当 GET /preferences 返回 reminderEligible=true 时可开启；永久订阅不可开启" },
    memberSchedules: { type: "array", maxItems: 20, items: { $ref: "#/components/schemas/MemberScheduleWrite" }, description: "每位成员的独立收款计划及邮件提醒开关；PATCH 需同时传 expectedUpdatedAt，传空数组清除，省略则保留。已有成员须传回 id 和最新 lastCollectedAt，不会创建登录子账号" },
  };
  const patchProperties = {
    ...writableProperties,
    expectedUpdatedAt: { type: "string", format: "date-time", description: "修改 memberSchedules 时必填；先 GET 订阅，原样回传其最新 updatedAt，防止覆盖或删除更新后的成员计划" },
  };
  const subscriptionResponse = {
    description: "订阅",
    content: { "application/json": { schema: { type: "object", properties: { subscription: { $ref: "#/components/schemas/Subscription" } } } } },
  };

  return Response.json({
    openapi: "3.1.0",
    info: {
      title: "TuD AI API",
      version: "1.2.0",
      description: `管理当前用户的订阅、图标、分类、排序和汇总偏好。${aiWriteConfirmationRule}`,
    },
    servers: [{ url: `${origin}/api/ai/v1` }],
    security: [{ bearerAuth: [] }],
    paths: {
      "/": { get: { operationId: "getCapabilities", summary: "读取能力、字段、示例及账户能力", responses: { "200": { description: "完整能力说明" }, "401": { $ref: "#/components/responses/Unauthorized" } } } },
      "/subscriptions": {
        get: {
          operationId: "listSubscriptions", summary: "列出订阅",
          parameters: [{ name: "status", in: "query", schema: { type: "string", enum: ["active", "archived", "all"], default: "active" } }],
          responses: { "200": { description: "订阅列表" }, "400": { $ref: "#/components/responses/InvalidRequest" } },
        },
        post: {
          operationId: "createSubscription", summary: "创建订阅",
          description: `先搜索或创建图标取得 iconId。${aiWriteConfirmationRule}`,
          requestBody: jsonBody({ $ref: "#/components/schemas/SubscriptionCreate" }, { name: "Claude Pro", iconId: "lobe-icons:claude", groupName: "AI 工具", amount: 20, currencyCode: "USD", billingCycle: "monthly", dueDate: "2026-09-12", website: "https://claude.ai" }),
          responses: { "201": subscriptionResponse, "400": { $ref: "#/components/responses/InvalidRequest" } },
        },
      },
      "/subscriptions/order": {
        patch: {
          operationId: "reorderSubscriptions", summary: "调整全部有效订阅顺序", description: `ids 必须完整包含所有有效订阅 ID。${aiWriteConfirmationRule}`,
          requestBody: jsonBody({ $ref: "#/components/schemas/OrderRequest" }),
          responses: { "200": { description: "保存后的 ID 顺序" }, "400": { $ref: "#/components/responses/InvalidRequest" } },
        },
      },
      "/subscriptions/{id}": {
        parameters: [idParameter],
        get: { operationId: "getSubscription", summary: "读取有效或已归档订阅", responses: { "200": subscriptionResponse, "404": { $ref: "#/components/responses/NotFound" } } },
        patch: {
          operationId: "updateSubscription", summary: "更新有效订阅", description: `只发送要修改的字段。${aiWriteConfirmationRule}`,
          requestBody: jsonBody({ $ref: "#/components/schemas/SubscriptionPatch" }, { amount: 25, currencyCode: "USD", notes: "已升级套餐" }),
          responses: { "200": subscriptionResponse, "400": { $ref: "#/components/responses/InvalidRequest" }, "404": { $ref: "#/components/responses/NotFound" }, "409": { $ref: "#/components/responses/Conflict" } },
        },
        delete: {
          operationId: "deleteSubscription", summary: "归档或永久删除订阅",
          description: `默认仅归档，可恢复。永久删除要求 permanent=true 且 confirm 参数等于订阅 ID；必须单独说明不可恢复后再确认。${aiWriteConfirmationRule}`,
          parameters: [{ name: "permanent", in: "query", schema: { type: "boolean", default: false } }, { name: "confirm", in: "query", schema: { type: "string" }, description: "永久删除时必须再次提供同一订阅 ID" }],
          responses: { "200": { description: "归档或删除结果" }, "400": { $ref: "#/components/responses/InvalidRequest" } },
        },
      },
      "/subscriptions/{id}/restore": {
        post: { operationId: "restoreSubscription", summary: "恢复已归档订阅", description: aiWriteConfirmationRule, parameters: [idParameter], responses: { "200": subscriptionResponse, "400": { $ref: "#/components/responses/InvalidRequest" } } },
      },
      "/subscriptions/{id}/renew": {
        post: {
          operationId: "renewSubscription", summary: "续费并推进日期", description: `仅支持 monthly、quarterly、semiannual、yearly、biennial、triennial；custom 和 lifetime 不可自动推进。${aiWriteConfirmationRule}`,
          parameters: [idParameter], responses: { "200": subscriptionResponse, "400": { $ref: "#/components/responses/InvalidRequest" }, "404": { $ref: "#/components/responses/NotFound" } },
        },
      },
      "/categories": {
        get: { operationId: "listCategories", summary: "列出完整分类顺序", responses: { "200": { description: "分类名称数组" } } },
        post: { operationId: "createCategory", summary: "创建空分类", description: aiWriteConfirmationRule, requestBody: jsonBody({ $ref: "#/components/schemas/CategoryCreate" }, { name: "AI 工具" }), responses: { "201": { description: "已创建" }, "400": { $ref: "#/components/responses/InvalidRequest" } } },
        patch: { operationId: "reorderCategories", summary: "调整全部分类顺序", description: `names 必须完整包含全部分类。${aiWriteConfirmationRule}`, requestBody: jsonBody({ $ref: "#/components/schemas/CategoryOrder" }), responses: { "200": { description: "保存后的分类顺序" }, "400": { $ref: "#/components/responses/InvalidRequest" } } },
        delete: { operationId: "deleteCategory", summary: "删除分类并迁移其中订阅", description: aiWriteConfirmationRule, requestBody: jsonBody({ $ref: "#/components/schemas/CategoryDelete" }, { name: "旧分类", replacement: "其他" }), responses: { "200": { description: "迁移和删除结果" }, "400": { $ref: "#/components/responses/InvalidRequest" } } },
      },
      "/icons": {
        get: { operationId: "searchIcons", summary: "搜索图标", parameters: [{ name: "q", in: "query", schema: { type: "string", maxLength: 64 } }, { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 24, default: 12 } }], responses: { "200": { description: "可写入订阅的 iconId 列表" }, "503": { description: "图标库暂时不可用" } } },
      },
      "/icons/discover": {
        post: { operationId: "discoverWebsiteIcon", summary: "发现官方网站图标", description: `仅在搜索无合适结果时使用；服务端执行 SSRF 安全检查和限流。${aiWriteConfirmationRule}`, requestBody: jsonBody({ $ref: "#/components/schemas/IconDiscover" }, { website: "https://example.com" }), responses: { "200": { description: "已有图标" }, "201": { description: "发现并创建图标" }, "400": { $ref: "#/components/responses/InvalidRequest" }, "422": { description: "网站没有可用图标" }, "429": { description: "请求过于频繁；Retry-After 响应头给出重试等待秒数" } } },
      },
      "/icons/monogram": {
        post: { operationId: "createMonogramIcon", summary: "创建字母图标", description: `品牌图标不可用时的明确回退方案。${aiWriteConfirmationRule}`, requestBody: jsonBody({ $ref: "#/components/schemas/MonogramCreate" }, { text: "AI", accent: "2563eb" }), responses: { "201": { description: "返回可写入订阅的 iconId" }, "400": { $ref: "#/components/responses/InvalidRequest" } } },
      },
      "/preferences": {
        get: { operationId: "getPreferences", summary: "读取汇总币种与提醒资格", responses: { "200": { description: "账户能力与偏好" } } },
        patch: { operationId: "updatePreferences", summary: "修改网页与票据默认汇总币种", description: aiWriteConfirmationRule, requestBody: jsonBody({ $ref: "#/components/schemas/PreferencesPatch" }, { summaryCurrency: "USD" }), responses: { "200": { description: "保存后的偏好" }, "400": { $ref: "#/components/responses/InvalidRequest" } } },
      },
      "/ticket": {
        post: {
          operationId: "createSubscriptionTicket",
          summary: "生成 PNG 订阅票或结构化票据数据",
          description: "默认直接返回 image/png，可原生展示或保存；传 format=json 时返回结构化数据。不传 selectedIds 时包含全部有效订阅；summaryCurrency 只影响本次票据，不修改偏好。单张 PNG 最多展示 100 项订阅。",
          requestBody: jsonBody({ $ref: "#/components/schemas/TicketRequest" }, { selectedIds: ["订阅 ID 1", "订阅 ID 2"], summaryCurrency: "CNY", format: "png" }),
          responses: {
            "200": {
              description: "PNG 图片，或显式请求的结构化票据数据",
              content: {
                "image/png": { schema: { type: "string", format: "binary" } },
                "application/json": { schema: { type: "object", properties: { ticket: { type: "object" } } } },
              },
            },
            "400": { $ref: "#/components/responses/InvalidRequest" },
          },
        },
      },
    },
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "TuD AI Key", description: "Authorization: Bearer tud_ai_..." } },
      schemas: {
        Error: { type: "object", required: ["error", "message"], properties: { error: { type: "string" }, message: { type: "string" } } },
        SubscriptionCreate: {
          type: "object", required: ["name", "iconId"], properties: writableProperties, additionalProperties: false,
          allOf: [{ if: { properties: { billingCycle: { const: "lifetime" } }, required: ["billingCycle"] }, then: {}, else: { required: ["dueDate"] } }],
        },
        SubscriptionPatch: { type: "object", minProperties: 1, properties: patchProperties, additionalProperties: false, allOf: [{ if: { required: ["memberSchedules"] }, then: { required: ["expectedUpdatedAt"] } }] },
        Subscription: { type: "object", required: ["id", "name", "iconId", "groupName", "currencyCode", "billingCycle", "memberSchedules", "sortPosition", "isArchived"], properties: { id: { type: "string" }, ...writableProperties, memberSchedules: { type: "array", items: { $ref: "#/components/schemas/MemberSchedule" } }, accent: { type: "string" }, sortPosition: { type: "integer" }, isArchived: { type: "boolean" }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" } } },
        MemberScheduleWrite: {
          type: "object", required: ["name", "amountMinor", "currencyCode", "nextDueDate", "intervalCount", "intervalUnit"], additionalProperties: false,
          allOf: [{ if: { required: ["id"] }, then: { required: ["lastCollectedAt"] } }],
          description: "新增成员省略 id 和 lastCollectedAt；PATCH 保留已有成员时传回其 id 及最新 lastCollectedAt（首次收款前为 null）。未传回的成员将从计划中移除。anchorDay 由服务端维护，写入时省略。",
          properties: {
            id: { type: "string", format: "uuid", description: "已有成员的稳定 ID；新增时省略" },
            name: { type: "string", minLength: 1, maxLength: 80, description: "成员名称，不区分大小写且不能重名" },
            joinedDate: { type: ["string", "null"], format: "date", description: "加入日期，YYYY-MM-DD；可省略或为 null" },
            amountMinor: { type: "integer", minimum: 0, maximum: 2147483647, description: "此成员每次应付金额，使用 currencyCode 的最小单位" },
            currencyCode: { type: "string", enum: aiCurrencies, description: "此成员的付款币种，可以不同于订阅币种" },
            nextDueDate: { type: "string", format: "date", description: "下次应收日期，YYYY-MM-DD" },
            intervalCount: { type: "integer", minimum: 1, maximum: 3650, description: "重复间隔；day 最多 3650、week 520、month 120、year 10" },
            intervalUnit: { type: "string", enum: ["day", "week", "month", "year"] },
            reminderEnabled: { type: "boolean", default: false, description: "仅当 reminderEligible=true 时可开启；收款前 1 天提醒管理者账号邮箱，同一订阅同日收款合并发送" },
            anchorDay: { type: "integer", minimum: 1, maximum: 31, readOnly: true, description: "写入时省略；若传入必须与服务端按 nextDueDate 推导或保留的值一致" },
            lastCollectedAt: { type: ["string", "null"], format: "date-time", description: "已有成员必填；原样回传 GET 的最新值，不能手动修改" },
          },
        },
        MemberSchedule: {
          type: "object", required: ["id", "name", "joinedDate", "amountMinor", "currencyCode", "nextDueDate", "intervalCount", "intervalUnit", "reminderEnabled", "anchorDay", "lastCollectedAt"], additionalProperties: false,
          properties: {
            id: { type: "string", format: "uuid" },
            name: { type: "string" },
            joinedDate: { type: ["string", "null"], format: "date" },
            amountMinor: { type: "integer" },
            currencyCode: { type: "string", enum: aiCurrencies },
            nextDueDate: { type: "string", format: "date" },
            intervalCount: { type: "integer" },
            intervalUnit: { type: "string", enum: ["day", "week", "month", "year"] },
            reminderEnabled: { type: "boolean", description: "收款前 1 天提醒管理者账号邮箱" },
            anchorDay: { type: "integer", minimum: 1, maximum: 31, readOnly: true, description: "每月或每年续期使用的原始日期；服务端根据手动设置的下次收款日维护，避免月末日期逐期漂移" },
            lastCollectedAt: { type: ["string", "null"], format: "date-time", readOnly: true },
          },
        },
        OrderRequest: { type: "object", required: ["ids"], properties: { ids: { type: "array", items: { type: "string" }, uniqueItems: true } }, additionalProperties: false },
        CategoryCreate: { type: "object", required: ["name"], properties: { name: { type: "string", maxLength: 30 } }, additionalProperties: false },
        CategoryOrder: { type: "object", required: ["names"], properties: { names: { type: "array", items: { type: "string", maxLength: 30 }, uniqueItems: true } }, additionalProperties: false },
        CategoryDelete: { type: "object", required: ["name"], properties: { name: { type: "string" }, replacement: { type: "string", default: "其他" } }, additionalProperties: false },
        IconDiscover: { type: "object", required: ["website"], properties: { website: { type: "string", format: "uri" } }, additionalProperties: false },
        MonogramCreate: { type: "object", required: ["text"], properties: { text: { type: "string", minLength: 1, maxLength: 5, description: "最多 5 个 Unicode 字素，只允许文字、英文字母或数字" }, accent: { type: "string", pattern: "^#?[0-9a-fA-F]{6}$" } }, additionalProperties: false },
        PreferencesPatch: { type: "object", required: ["summaryCurrency"], properties: { summaryCurrency: { type: "string", enum: aiCurrencies } }, additionalProperties: false },
        TicketRequest: { type: "object", properties: { selectedIds: { type: "array", items: { type: "string" }, uniqueItems: true }, summaryCurrency: { type: "string", enum: aiCurrencies }, format: { type: "string", enum: ["png", "json"], default: "png", description: "png 直接返回图片；json 返回适合分析的结构化数据" } }, additionalProperties: false },
      },
      responses: {
        Unauthorized: errorResponse("AI Key 缺失、无效或已撤销"),
        InvalidRequest: errorResponse("字段、金额、周期、日期或操作不正确"),
        Conflict: errorResponse("订阅或成员收款状态已变化；重新读取最新订阅后再提交"),
        NotFound: errorResponse("资源不存在或不属于当前用户"),
      },
    },
    "x-tud-safety": { confirmationRequiredForWrites: true, permanentDeletionNeedsSeparateConfirmation: true, credentialsNeverReturned: true },
    "x-tud-limitations": ["单张 PNG 订阅票最多展示 100 项订阅", "每把 Key 只能访问创建它的用户数据"],
  }, { headers: { "Cache-Control": "public, max-age=3600" } });
}

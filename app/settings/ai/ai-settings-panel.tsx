"use client";

import { useMemo, useState } from "react";
import { ArchiveRestore, Braces, CalendarSync, Copy, FileJson2, House, Image as ImageIcon, KeyRound, ListFilter, Plus, ReceiptText, ShieldCheck, Sparkles, Tags, Trash2 } from "lucide-react";
import Link from "next/link";

type KeyItem = {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date | string;
  lastUsedAt: Date | string | null;
};

function aiPrompt(origin: string, token: string) {
  return `你是我的 TuD 订阅管理助手。

连接信息
- API 基地址：${origin}/api/ai/v1
- OpenAPI 说明：${origin}/api/ai/v1/openapi
- AI Key：${token}
- 除 OpenAPI 外，所有请求都使用 Authorization: Bearer <AI Key>；写入请求使用 JSON。

你可以执行
- GET /subscriptions：列出全部订阅，并按名称、分类、账号、币种或到期日分析和筛选。
- GET /subscriptions/{id}：读取单项完整详情。不要猜 ID，先查询。
- POST /subscriptions：创建订阅。
- PATCH /subscriptions/{id}：更新订阅。
- POST /subscriptions/{id}/renew：把续费日准确推进一个账单周期。
- DELETE /subscriptions/{id}：归档订阅；永久删除必须添加 ?permanent=true&confirm={id}。
- POST /subscriptions/{id}/restore：恢复已归档订阅。
- PATCH /subscriptions/order：调整全部有效订阅顺序。
- GET、POST、PATCH、DELETE /categories：查询、创建、排序、删除分类并迁移其中订阅。
- GET /icons?q=名称：搜索图标；无结果时用 POST /icons/discover 或 POST /icons/monogram。
- GET、PATCH /preferences：读取提醒资格和汇总币种，或修改网页默认汇总币种。
- POST /ticket：默认直接生成可展示、保存或转发的 PNG 订阅票；传 format=json 时返回汇总总额、原币种小计、分类、最近续费日和明细。
- 用户要求订阅票时，调用 /ticket 并把返回的 PNG 作为图片直接交付，不要只用文字复述票据内容。

写入字段
- name、iconId、groupName、amount、currencyCode、billingCycle、dueDate、cardAccent、accountName、website、notes、reminderEnabled。
- 创建订阅前必须先搜索或创建图标并取得 iconId；不要编造 iconId。
- amount 使用主单位，例如 12.99 美元写 12.99；不要与 amountMinor 同时发送。
- billingCycle 只能是 monthly、quarterly、semiannual、yearly、biennial、triennial、custom、lifetime。
- 除 lifetime 外，dueDate 使用 YYYY-MM-DD。
- cardAccent 使用 6 位十六进制颜色；null 表示跟随图标。
- reminderEnabled 仅在 GET /preferences 返回 reminderEligible=true 时可开启。

操作规则
- 读取、分析和生成订阅票可以直接执行。
- 任何写入前都必须复述具体变更并获得我的明确确认。
- 永久删除不可恢复，必须单独说明后再次获得明确确认；通常优先归档。
- custom 和 lifetime 不能自动推进续费日期。
- 信息含糊时先提问；操作后报告 API 实际返回结果，不要声称未执行的操作已经完成。
- 不要在回复中展示完整 Key，也不要把 Key 发送给 TuD 以外的服务。

现在先读取 OpenAPI 或 GET /api/ai/v1 的说明，然后等待我的任务。`;
}

function dateText(value: Date | string | null) {
  if (!value) return "从未使用";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function AiSettingsPanel({ name, initialKeys, origin }: { name: string; initialKeys: KeyItem[]; origin: string }) {
  const [keys, setKeys] = useState(initialKeys);
  const [keyName, setKeyName] = useState("我的 AI 助手");
  const [createdToken, setCreatedToken] = useState("");
  const [createdKeyId, setCreatedKeyId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<"key" | "prompt" | "template" | "">("");
  const [revokeId, setRevokeId] = useState<string | null>(null);

  const template = useMemo(() => aiPrompt(origin, createdToken || "<在此粘贴 TuD AI Key>"), [createdToken, origin]);

  async function createKey() {
    setPending(true);
    setError("");
    const response = await fetch("/api/ai-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: keyName }),
    });
    const body = await response.json().catch(() => ({})) as KeyItem & { token?: string; error?: string };
    setPending(false);
    if (!response.ok || !body.token) return setError(body.error ?? "Key 创建失败");
    setKeys((items) => [...items, body]);
    setCreatedToken(body.token);
    setCreatedKeyId(body.id);
    setCopied("");
  }

  async function revokeKey(id: string) {
    setPending(true);
    setError("");
    const response = await fetch("/api/ai-keys", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    setPending(false);
    if (!response.ok) return setError(body.error ?? "撤销失败");
    setKeys((items) => items.filter((item) => item.id !== id));
    if (createdKeyId === id) {
      setCreatedToken("");
      setCreatedKeyId(null);
    }
    setRevokeId(null);
  }

  async function copy(value: string, type: "key" | "prompt" | "template") {
    await navigator.clipboard.writeText(value);
    setCopied(type);
    window.setTimeout(() => setCopied(""), 1800);
  }

  return <main className="security-page ai-page">
    <header className="security-header"><Link href="/" className="back-link"><House size={16} />返回</Link></header>
    <div className="security-wrap ai-settings-wrap">
      <div className="security-heading"><span>AI CONNECTION</span><h1>让 AI 连接 TuD</h1><p>{name} · 用一把可随时撤销的 Key，把订阅交给你信任的 AI 管理。</p></div>

      <section className="ai-intro-card">
        <span><Sparkles size={24} /></span>
        <div><h2>把 TuD 交给你的 AI</h2><p>适用于能发送 HTTP 请求并设置 Authorization 请求头的 AI、Agent 或自动化工具。它可以读取、分析和整理订阅，并在你确认后执行写入。</p></div>
      </section>

      <section className="ai-endpoint-card">
        <div><span>TuD API 地址</span><code>{origin}/api/ai/v1</code></div>
        <div className="ai-endpoint-key-create">
          <label><span>Key 名称</span><input value={keyName} onChange={(event) => setKeyName(event.target.value)} maxLength={40} placeholder="例如：Claude 桌面端" /></label>
          <button onClick={createKey} disabled={pending || keys.length >= 5}><Plus size={16} />{pending ? "正在创建…" : keys.length >= 5 ? "已达上限" : "创建 AI Key"}</button>
        </div>
        {createdToken && <div className="ai-secret-panel" role="status">
          <div><ShieldCheck size={17} /><strong>Key 已创建，只会显示这一次</strong></div>
          <code>{createdToken}</code>
          <button onClick={() => copy(createdToken, "key")}><Copy size={15} />{copied === "key" ? "已复制" : "复制 Key"}</button>
        </div>}
      </section>

      <section className="security-card-main ai-capabilities-card">
        <div className="ai-section-heading"><span>CAPABILITIES</span><h2>AI 可以做什么</h2><p>下面是当前真实开放的能力，不需要让 AI 猜。</p></div>
        <div className="ai-capability-grid">
          <article><span><ListFilter size={20} /></span><div><strong>查询与整理</strong><p>读取全部订阅或单项详情，按名称、分类、账号、币种和到期日筛选，找出即将续费或缺少金额的信息。</p></div></article>
          <article><span><FileJson2 size={20} /></span><div><strong>创建与更新</strong><p>设置服务名、分类、金额、币种、周期、续费日、账号、官网、备注和提醒；更新前会先向你确认。</p></div></article>
          <article><span><CalendarSync size={20} /></span><div><strong>完成续费</strong><p>读取订阅 ID 后，将续费日期准确推进一个账单周期，支持月、季度、半年、一年至三年周期。</p></div></article>
          <article><span><ReceiptText size={20} /></span><div><strong>生成订阅票</strong><p>选择全部或指定订阅，按目标币种汇总月均支出，直接生成带品牌图标、分类和续费信息的 PNG 长图。</p></div></article>
          <article><span><ImageIcon size={20} /></span><div><strong>选择正确图标</strong><p>搜索内置品牌图标、从官方网站发现图标，或创建最多 5 个字符的字母图标，再把真实 iconId 写入订阅。</p></div></article>
          <article><span><Tags size={20} /></span><div><strong>管理分类与顺序</strong><p>读取完整分类列表，创建、排序或删除分类并迁移订阅，也可以调整全部有效订阅的卡片顺序。</p></div></article>
          <article><span><ArchiveRestore size={20} /></span><div><strong>归档与恢复</strong><p>默认使用可恢复的归档；确实需要时才永久删除，并要求 AI 单独说明不可恢复风险后再次确认。</p></div></article>
        </div>
        <div className="ai-example-prompts"><span>你可以这样说</span><p>“列出未来 30 天要续费的服务”</p><p>“把 Claude Pro 以每月 20 USD、下月 12 日续费加入 AI 分类”</p><p>“生成一张以 CNY 汇总的订阅票”</p></div>
      </section>

      <section className="security-card-main ai-key-card">
        <div className="security-card-title">
          <span><KeyRound size={22} /></span>
          <div><h2>管理 AI Key</h2><p>查看已创建的 Key、最近使用时间，或立即撤销访问权限。最多保留 5 把。</p></div>
        </div>
        {error && <p className="security-message error" role="alert">{error}</p>}
        <div className="ai-key-list">
          {keys.length ? keys.map((item) => <article key={item.id}>
            <span><KeyRound size={18} /></span>
            <div><strong>{item.name}</strong><small>{item.prefix} · 创建于 {dateText(item.createdAt)} · 最近使用 {dateText(item.lastUsedAt)}</small></div>
            {revokeId === item.id ? <div className="ai-revoke-confirm"><button onClick={() => setRevokeId(null)}>取消</button><button onClick={() => revokeKey(item.id)} disabled={pending}>确认撤销</button></div> : <button aria-label={`撤销 ${item.name}`} onClick={() => setRevokeId(item.id)}><Trash2 size={17} /></button>}
          </article>) : <div className="ai-key-empty">还没有 AI Key。创建后，完整 Key 仅显示一次。</div>}
        </div>
      </section>

      <section className="security-card-main ai-prompt-card">
        <div className="security-card-title">
          <span><Braces size={22} /></span>
          <div><h2>直接丢给 AI</h2><p>{createdToken ? "已自动放入刚创建的 Key，可以整段复制。" : "先创建 Key，或复制模板后自行替换尖括号里的内容。"}</p></div>
          <button onClick={() => copy(template, createdToken ? "prompt" : "template")}><Copy size={15} />{copied === "prompt" || copied === "template" ? "已复制" : "复制整段"}</button>
        </div>
        <div className="ai-prompt-text">{template}</div>
      </section>

      <section className="security-card-main ai-reference-card">
        <div className="ai-section-heading"><span>API REFERENCE</span><h2>给人看的操作说明</h2><p>复制提示词已经包含这些信息；这里方便你自己核对。</p></div>
        <div className="ai-endpoint-list">
          <div><code>GET /openapi</code><span>OpenAPI 3.1 机器可读说明，无需 Key</span></div>
          <div><code>GET /subscriptions</code><span>列出全部订阅</span></div>
          <div><code>GET /subscriptions/{`{id}`}</code><span>读取一项订阅</span></div>
          <div><code>POST /subscriptions</code><span>创建订阅</span></div>
          <div><code>PATCH /subscriptions/{`{id}`}</code><span>更新任意已开放字段</span></div>
          <div><code>POST /subscriptions/{`{id}`}/renew</code><span>续费并推进日期</span></div>
          <div><code>DELETE /subscriptions/{`{id}`}</code><span>归档；永久删除还需 permanent=true 和 confirm={`{id}`}</span></div>
          <div><code>POST /subscriptions/{`{id}`}/restore</code><span>恢复已归档订阅</span></div>
          <div><code>PATCH /subscriptions/order</code><span>调整全部有效订阅顺序</span></div>
          <div><code>GET · POST · PATCH · DELETE /categories</code><span>完整分类管理</span></div>
          <div><code>GET /icons?q=名称</code><span>搜索图标并取得 iconId</span></div>
          <div><code>POST /icons/discover</code><span>从官方网站发现图标</span></div>
          <div><code>POST /icons/monogram</code><span>创建字母图标回退</span></div>
          <div><code>GET · PATCH /preferences</code><span>提醒资格与汇总币种偏好</span></div>
          <div><code>POST /ticket</code><span>生成 PNG 订阅票，或返回结构化数据</span></div>
        </div>
        <dl className="ai-field-reference">
          <div><dt>金额</dt><dd><code>amount</code> 使用主单位，例如 12.99；不要和 <code>amountMinor</code> 同时传。</dd></div>
          <div><dt>日期</dt><dd><code>dueDate</code> 使用 YYYY-MM-DD；永久订阅无需日期。</dd></div>
          <div><dt>周期</dt><dd>monthly / quarterly / semiannual / yearly / biennial / triennial / custom / lifetime</dd></div>
          <div><dt>图标</dt><dd>创建订阅前先调用 <code>/icons</code>；不得猜测 <code>iconId</code>。搜索无结果时再发现官网图标或创建字母图标。</dd></div>
          <div><dt>分类</dt><dd><code>groupName</code> 不存在时自动创建；<code>/categories</code> 可管理空分类、顺序和迁移。</dd></div>
          <div><dt>提醒</dt><dd>先读取 <code>/preferences</code>；只有 <code>reminderEligible=true</code> 才能开启。</dd></div>
          <div><dt>颜色</dt><dd><code>cardAccent</code> 使用 6 位十六进制颜色，传 null 恢复跟随图标。</dd></div>
          <div><dt>订阅票</dt><dd><code>selectedIds</code> 可选；<code>summaryCurrency</code> 指定汇总币种；默认返回 PNG 图片，只有需要分析明细时才传 <code>{`format: "json"`}</code>。</dd></div>
        </dl>
        <div className="ai-request-examples">
          <article><header><strong>创建订阅</strong><code>POST /subscriptions</code></header><pre><code>{`{
  "name": "Claude Pro",
  "iconId": "lobe-icons:claude",
  "groupName": "AI 工具",
  "amount": 20,
  "currencyCode": "USD",
  "billingCycle": "monthly",
  "dueDate": "2026-09-12",
  "website": "https://claude.ai",
  "notes": "个人工作账号"
}`}</code></pre></article>
          <article><header><strong>更新订阅</strong><code>PATCH /subscriptions/{`{id}`}</code></header><pre><code>{`{
  "amount": 25,
  "currencyCode": "USD",
  "dueDate": "2026-10-12",
  "notes": "已升级套餐"
}`}</code></pre></article>
          <article><header><strong>生成订阅票</strong><code>POST /ticket</code></header><pre><code>{`{
  "selectedIds": ["订阅 ID 1", "订阅 ID 2"],
  "summaryCurrency": "CNY",
  "format": "png"
}`}</code></pre></article>
        </div>
        <div className="ai-limitations"><strong>安全边界</strong><p>所有写入都要先确认；永久删除还要单独说明不可恢复风险并再次确认。订阅票默认返回 PNG 图片，单张最多展示 100 项；需要计算或解释明细时可请求 JSON。每把 Key 只允许访问创建它的用户数据。</p></div>
      </section>

      <aside className="ai-security-note"><ShieldCheck size={17} /><p><strong>像密码一样保管 Key。</strong>只交给你信任的 AI；不要截图、提交到代码仓库或发到公开对话。发现异常时，回到这里立即撤销。</p></aside>
    </div>
  </main>;
}

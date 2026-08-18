"use client";

import { type CSSProperties, type DragEvent, type FormEvent, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  CalendarDays,
  CalendarRange,
  BellRing,
  Camera,
  Check,
  ChevronDown,
  ExternalLink,
  GripVertical,
  Grid2X2,
  List,
  LogOut,
  MoveDown,
  MoveUp,
  Pencil,
  Plus,
  Search,
  Settings,
  Sparkles,
  Ticket,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import {
  billingCycleLabel,
  billingCycleOptions,
  currencyFractionDigits,
  currencyOptions,
  isAutoRenewableCycle,
  majorToMinor,
  minorToMajor,
  type SupportedCurrency,
} from "../../lib/subscription-options";
import { emptyBrandChoice, type BrandChoice } from "../../lib/brand-options";
import { iconSurfaceTheme, normalizedIconColor } from "../../lib/icon-color";
import type { SubscriptionRecord } from "../../db/subscriptions";
import { authClient } from "../../lib/auth-client";
import { BrandIcon } from "./BrandIcon";
import { BrandPicker } from "./BrandPicker";
import { CalendarView } from "./CalendarView";
import { DateField } from "./DateField";
import { daysUntilLocalDate, localDateKey } from "../../lib/subscription-calendar";
import { formatCurrencyAmount, formatMonthlySpend, formatSubscriptionDate, monthlySpendByCurrency, totalMonthlySpendInCurrency } from "../../lib/subscription-display";
import { groupSubscriptionsByCategory } from "../../lib/subscription-order";
import { SubscriptionTicketModal } from "./SubscriptionTicket";

type ViewMode = "grid" | "list" | "calendar";
type CategoryGroup = { name: string; count: number };
type CategoryDeleteResult = { name: string; moved: number; replacement: string | null };

function dateAtNoon(date: string) {
  return new Date(`${date}T12:00:00`);
}

function daysUntil(date: string | null) {
  return daysUntilLocalDate(date);
}

function formatMoney(item: SubscriptionRecord) {
  if (item.amountMinor == null) return "—";
  return formatCurrencyAmount(minorToMajor(item.amountMinor, item.currencyCode), item.currencyCode, currencyFractionDigits(item.currencyCode));
}

function formatMajorMoney(amount: number, currency: string) {
  return formatCurrencyAmount(amount, currency, currencyFractionDigits(currency));
}

function formatDueDate(item: SubscriptionRecord) {
  if (item.billingCycle === "lifetime") return "永久有效";
  if (!item.dueDate) return "未设置日期";
  return formatSubscriptionDate(item.dueDate);
}

function urgencyLabel(item: SubscriptionRecord) {
  if (item.billingCycle === "lifetime") return "永久";
  const days = daysUntil(item.dueDate);
  if (days == null) return "待设置";
  if (days < 0) return "已到期";
  if (days === 0) return "今天";
  if (days === 1) return "明天";
  if (days <= 30) return `${days} 天后`;
  return new Intl.DateTimeFormat("zh-CN", { month: "short" }).format(dateAtNoon(item.dueDate!));
}

function defaultDueDate() {
  const now = new Date();
  return localDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30));
}

function editableAmount(item?: SubscriptionRecord | null) {
  if (!item || item.amountMinor == null) return "";
  return String(minorToMajor(item.amountMinor, item.currencyCode));
}

function useModalBehavior(onClose: () => void) {
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}

function initialBrand(item?: SubscriptionRecord): BrandChoice {
  if (!item) return emptyBrandChoice;
  const indexedSource = item.iconId?.split(":", 1)[0];
  const source = indexedSource === "hd" || indexedSource === "hd-icons" ? "hd-icons"
    : indexedSource === "dashboard" || indexedSource === "dashboard-icons" ? "dashboard-icons"
      : indexedSource === "lobe" || indexedSource === "lobe-icons" ? "lobe-icons"
        : indexedSource === "selfhst" || indexedSource === "selfhst-icons" ? "selfhst-icons"
          : indexedSource === "monogram" ? "monogram"
          : indexedSource === "website" ? "website"
            : indexedSource === "simple" || indexedSource === "simple-icons" || item.iconKey.startsWith("simple-") ? "simple-icons"
              : "local";
  return {
    iconId: item.iconId,
    iconKey: item.iconKey,
    accent: item.accent,
    title: item.name,
    source,
  };
}

type ProfileRecord = { name: string; email: string; image: string | null };

const cardAccentPresets = [
  "#3977d6",
  "#279376",
  "#6f62b5",
  "#bd6680",
  "#c98543",
  "#478a9f",
  "#88705f",
  "#566273",
];

function subscriptionSurfaceStyle(accent: string | null | undefined) {
  const theme = iconSurfaceTheme(accent);
  return {
    "--surface-accent": theme.base,
    "--surface-primary": theme.washPrimary,
    "--surface-cool": theme.washCool,
    "--surface-warm": theme.washWarm,
    "--surface-border": theme.border,
  } as CSSProperties;
}

function subscriptionAccent(item: Pick<SubscriptionRecord, "accent" | "cardAccent">) {
  return item.cardAccent ? `#${item.cardAccent}` : item.accent;
}

function useResolvedSubscriptionAccent(item: Pick<SubscriptionRecord, "accent" | "cardAccent">) {
  const configured = subscriptionAccent(item);
  const [resolved, setResolved] = useState({ source: configured, value: configured });
  const effective = resolved.source === configured ? resolved.value : configured;
  const onColorResolved = useCallback((color: string) => {
    if (!item.cardAccent) setResolved({ source: configured, value: color });
  }, [configured, item.cardAccent]);
  return { accent: effective, onColorResolved: item.cardAccent ? undefined : onColorResolved };
}

export function Dashboard({
  initialSubscriptions,
  initialCategories,
  displayName,
  profileImage = null,
  reminderEligible,
  initialSummaryCurrency,
}: {
  initialSubscriptions: SubscriptionRecord[];
  initialCategories: string[];
  displayName: string;
  profileImage?: string | null;
  reminderEligible: boolean;
  initialSummaryCurrency: SupportedCurrency;
}) {
  const [subscriptions, setSubscriptions] = useState(initialSubscriptions);
  const [categories, setCategories] = useState(initialCategories);
  const [query, setQuery] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("全部");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [showAdd, setShowAdd] = useState(false);
  const [showCategory, setShowCategory] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [showTicket, setShowTicket] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showReminderManager, setShowReminderManager] = useState(false);
  const [profileName, setProfileName] = useState(displayName);
  const [profileAvatar, setProfileAvatar] = useState(profileImage);
  const [summaryCurrency, setSummaryCurrency] = useState<SupportedCurrency>(initialSummaryCurrency);
  const [exchangeRates, setExchangeRates] = useState<Record<string, number> | null>(null);
  const [exchangeRateState, setExchangeRateState] = useState<"idle" | "ready" | "error">("idle");
  const [detailSubscription, setDetailSubscription] = useState<SubscriptionRecord | null>(null);
  const deferredQuery = useDeferredValue(query);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showAccount) return;
    const closeOutside = (event: PointerEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) setShowAccount(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowAccount(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [showAccount]);

  const groups = useMemo<CategoryGroup[]>(() => {
    const counts = new Map<string, number>();
    subscriptions.forEach((item) => counts.set(item.groupName, (counts.get(item.groupName) ?? 0) + 1));
    const names = new Set([...categories, ...counts.keys()]);
    return [
      { name: "全部", count: subscriptions.length },
      ...Array.from(names, (name) => ({ name, count: counts.get(name) ?? 0 })),
    ];
  }, [categories, subscriptions]);

  const filtered = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    const matches = subscriptions.filter((item) => {
      const matchesSearch = !needle || `${item.name} ${item.groupName} ${item.accountName ?? ""}`.toLowerCase().includes(needle);
      return matchesSearch && (selectedGroup === "全部" || item.groupName === selectedGroup);
    });
    return groupSubscriptionsByCategory(matches, categories);
  }, [subscriptions, categories, deferredQuery, selectedGroup]);

  const recurringSubscriptions = subscriptions.filter((item) => {
    if (!isAutoRenewableCycle(item.billingCycle) || !item.dueDate) return false;
    const remainingDays = daysUntil(item.dueDate);
    return remainingDays != null && remainingDays >= 0;
  });
  const nearestSubscription = [...recurringSubscriptions].sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))[0];

  const monthlySpend = useMemo(() => monthlySpendByCurrency(subscriptions), [subscriptions]);
  const needsConversion = monthlySpend.some((item) => item.currency !== summaryCurrency);
  const summaryTotal = useMemo(() => {
    return totalMonthlySpendInCurrency(monthlySpend, summaryCurrency, exchangeRates);
  }, [exchangeRates, monthlySpend, summaryCurrency]);

  useEffect(() => {
    if (!needsConversion || exchangeRates) return;
    const controller = new AbortController();
    void fetch("/api/exchange-rates", { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as { rates?: Record<string, number>; error?: string };
        if (!response.ok || !body.rates) throw new Error(body.error ?? "汇率加载失败");
        setExchangeRates(body.rates);
        setExchangeRateState("ready");
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setExchangeRateState("error");
      });
    return () => controller.abort();
  }, [exchangeRates, needsConversion]);

  async function changeSummaryCurrency(value: string) {
    const next = value as SupportedCurrency;
    const previous = summaryCurrency;
    setSummaryCurrency(next);
    const response = await fetch("/api/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ summaryCurrency: next }),
    });
    if (!response.ok) setSummaryCurrency(previous);
  }

  function replaceSubscription(updated: SubscriptionRecord) {
    setSubscriptions((items) => items.map((item) => item.id === updated.id ? updated : item));
    setDetailSubscription((current) => current?.id === updated.id ? updated : current);
    setCategories((items) => items.includes(updated.groupName) ? items : [...items, updated.groupName]);
  }

  function applyCategoryDelete(result: CategoryDeleteResult) {
    setCategories((items) => {
      const next = items.filter((name) => name !== result.name);
      return result.replacement && !next.includes(result.replacement) ? [...next, result.replacement] : next;
    });
    if (result.replacement) {
      setSubscriptions((items) => items.map((item) => item.groupName === result.name ? { ...item, groupName: result.replacement! } : item));
      setDetailSubscription((item) => item?.groupName === result.name ? { ...item, groupName: result.replacement! } : item);
    }
    if (selectedGroup === result.name) setSelectedGroup("全部");
  }

  async function signOut() {
    await authClient.signOut();
    window.location.href = "/login";
  }

  return (
    <main className="renewal-app">
      <header className="renewal-header">
        <Link className="renewal-brand" href="/" aria-label="TuD 首页">
          <Image src="/tud-mark.png" alt="" width={34} height={34} unoptimized />
          <strong>TuD</strong>
        </Link>

        <div className="renewal-account-wrap" ref={accountRef}>
          <button className="account-button" onClick={() => setShowAccount((value) => !value)} aria-label={`${profileName} 账户菜单`} aria-expanded={showAccount}>
            <UserAvatar name={profileName} image={profileAvatar} size={34} />
            <strong>{profileName}</strong>
            <ChevronDown size={15} />
          </button>
          {showAccount && (
            <div className="account-menu">
              <button onClick={() => { setShowAccount(false); setShowProfile(true); }}><UserRound size={16} />编辑资料</button>
              <button onClick={() => { window.location.href = "/settings/security"; }}><Settings size={16} />账户与安全</button>
              <button onClick={() => { window.location.href = "/settings/ai"; }}><Sparkles size={16} />AI 连接</button>
              {reminderEligible && <button onClick={() => { setShowAccount(false); setShowReminderManager(true); }} disabled={!subscriptions.some((item) => item.billingCycle !== "lifetime")}><BellRing size={16} />到期提醒</button>}
              <button onClick={() => { setShowAccount(false); setShowTicket(true); }} disabled={!subscriptions.length}><Ticket size={16} />订阅票</button>
              <button onClick={signOut}><LogOut size={16} />退出登录</button>
            </div>
          )}
        </div>
      </header>

      <section className="renewal-workspace">
        <div className="renewal-toolbar">
          <button className="primary-add" onClick={() => setShowAdd(true)}><Plus size={21} />添加订阅</button>
          <label className="renewal-search"><Search size={20} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索订阅，例如：Netflix" /></label>
          <div className="toolbar-actions">
            <div className="view-switcher" role="group" aria-label="切换订阅视图">
              <button className={viewMode === "grid" ? "selected" : ""} onClick={() => setViewMode("grid")} aria-label="网格视图" aria-pressed={viewMode === "grid"} title="网格视图"><Grid2X2 size={18} /></button>
              <button className={viewMode === "list" ? "selected" : ""} onClick={() => setViewMode("list")} aria-label="列表视图" aria-pressed={viewMode === "list"} title="列表视图"><List size={18} /></button>
              <button className={viewMode === "calendar" ? "selected" : ""} onClick={() => setViewMode("calendar")} aria-label="日历视图" aria-pressed={viewMode === "calendar"} title="日历视图"><CalendarRange size={18} /></button>
            </div>
          </div>
        </div>

        <section className="subscription-overview" aria-label="订阅概览">
          <div className="spend-summary">
            <div className="spend-summary-head"><span>预计月均支出</span><label><span>汇总币种</span><select aria-label="汇总币种" value={summaryCurrency} onChange={(event) => void changeSummaryCurrency(event.target.value)}>{currencyOptions.map((option) => <option key={option.value} value={option.value}>{option.value}</option>)}</select><ChevronDown size={13} /></label></div>
            <strong>{summaryTotal == null ? (exchangeRateState === "error" || exchangeRates ? "汇率暂不可用" : "换算中…") : formatMajorMoney(summaryTotal, summaryCurrency)}</strong>
            {monthlySpend.length > 0 && (needsConversion || monthlySpend.length > 1) && <small className="spend-breakdown" aria-label="各币种月均支出">
              {monthlySpend.map((item) => <span key={item.currency}>{item.currency} {formatMonthlySpend(item.amount, item.currency)}</span>)}
              {needsConversion && summaryTotal != null && <a href="https://www.exchangerate-api.com" target="_blank" rel="noreferrer">汇率来源</a>}
            </small>}
          </div>
          {nearestSubscription && (
            <div className="upcoming-summary">
              <BrandIcon iconId={nearestSubscription.iconId} iconKey={nearestSubscription.iconKey} accent={nearestSubscription.accent} size={48} />
              <div><span>下一笔续费</span><strong>{nearestSubscription.name}</strong></div>
              <div className="upcoming-amount"><strong>{formatMoney(nearestSubscription)}</strong><span>{urgencyLabel(nearestSubscription)}</span></div>
            </div>
          )}
        </section>

        <nav className="category-tabs" aria-label="订阅分类">
          {groups.map((group) => (
            <button key={group.name} className={selectedGroup === group.name ? "selected" : ""} onClick={() => setSelectedGroup(group.name)}>
              <span>{group.name}</span><em>{group.count}</em>
            </button>
          ))}
          <button className="add-category" onClick={() => setShowCategory(true)}><Settings size={14} /><span>管理分类</span></button>
        </nav>

        {viewMode === "calendar" ? (
          <section className="subscription-calendar-wrap">
            <CalendarView
              subscriptions={filtered}
              onSelectSubscription={(item) => setDetailSubscription(item)}
            />
          </section>
        ) : (
          <section className="subscription-collection">
            {!!filtered.length && (
            <div className={`renewal-grid ${viewMode === "list" ? "list-view" : ""}`}>
              {filtered.map((item) => (
                <SubscriptionTile
                  key={item.id}
                  item={item}
                  nearest={item.id === nearestSubscription?.id}
                  onOpen={() => setDetailSubscription(item)}
                />
              ))}
            </div>
            )}
          </section>
        )}

        {viewMode !== "calendar" && !filtered.length && (
          <section className="renewal-empty">
            <span className="renewal-empty-icon">{query ? <Search size={20} /> : <Plus size={20} />}</span>
            <div>
              <h2>{query ? "没有找到匹配项" : subscriptions.length ? "此分类还没有订阅" : "还没有订阅"}</h2>
              <p>{query ? "换个名称或分类试试。" : "添加一项，开始跟踪续费日期和支出。"}</p>
            </div>
            {!query && <button className="empty-add-button" onClick={() => setShowAdd(true)}><Plus size={16} />添加订阅</button>}
          </section>
        )}
      </section>

      <button className="mobile-fab" onClick={() => setShowAdd(true)} aria-label="添加订阅"><Plus size={22} /></button>
      {showAdd && (
        <AddSubscriptionModal
          categories={groups.filter((group) => group.name !== "全部").map((group) => group.name)}
          reminderEligible={reminderEligible}
          onClose={() => setShowAdd(false)}
          onSaved={(created) => {
            setSubscriptions((items) => [...items, created]);
            setCategories((items) => items.includes(created.groupName) ? items : [...items, created.groupName]);
            setShowAdd(false);
          }}
        />
      )}
      {detailSubscription && (
        <SubscriptionDetailModal
          key={`${detailSubscription.id}:${detailSubscription.accent}:${detailSubscription.cardAccent ?? "auto"}`}
          item={detailSubscription}
          categories={groups.filter((group) => group.name !== "全部").map((group) => group.name)}
          reminderEligible={reminderEligible}
          onClose={() => setDetailSubscription(null)}
          onSaved={replaceSubscription}
          onDeleted={(id) => {
            setSubscriptions((items) => items.filter((item) => item.id !== id));
            setDetailSubscription(null);
          }}
        />
      )}
      {showProfile && (
        <ProfileModal
          name={profileName}
          image={profileAvatar}
          onClose={() => setShowProfile(false)}
          onSaved={(profile) => {
            setProfileName(profile.name);
            setProfileAvatar(profile.image);
            setShowProfile(false);
          }}
        />
      )}
      {showCategory && (
        <CategoryManagerModal
          groups={groups.filter((group) => group.name !== "全部")}
          onClose={() => setShowCategory(false)}
          onCreated={(name) => setCategories((items) => items.includes(name) ? items : [...items, name])}
          onDeleted={applyCategoryDelete}
          onReordered={setCategories}
        />
      )}
      {showReminderManager && (
        <ReminderManagerModal
          subscriptions={subscriptions}
          onClose={() => setShowReminderManager(false)}
          onSaved={(updated) => {
            const byId = new Map(updated.map((item) => [item.id, item]));
            setSubscriptions((items) => items.map((item) => byId.get(item.id) ?? item));
            setDetailSubscription((item) => item ? byId.get(item.id) ?? item : null);
            setShowReminderManager(false);
          }}
        />
      )}
      {showTicket && <SubscriptionTicketModal subscriptions={subscriptions} categories={categories} initialSummaryCurrency={summaryCurrency} initialExchangeRates={exchangeRates} onClose={() => setShowTicket(false)} />}
    </main>
  );
}

function ReminderManagerModal({ subscriptions, onClose, onSaved }: { subscriptions: SubscriptionRecord[]; onClose: () => void; onSaved: (updated: SubscriptionRecord[]) => void }) {
  const eligible = useMemo(() => subscriptions.filter((item) => item.billingCycle !== "lifetime"), [subscriptions]);
  const initialEnabled = useMemo(() => new Set(eligible.filter((item) => item.reminderEnabled).map((item) => item.id)), [eligible]);
  const [enabledIds, setEnabledIds] = useState(() => new Set(initialEnabled));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const changed = eligible.filter((item) => enabledIds.has(item.id) !== initialEnabled.has(item.id));
  useModalBehavior(onClose);

  function toggle(id: string) {
    setEnabledIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!changed.length) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/subscriptions/reminders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates: changed.map((item) => ({ id: item.id, enabled: enabledIds.has(item.id) })) }),
      });
      const body = await response.json() as SubscriptionRecord[] & { error?: string };
      if (!response.ok || !Array.isArray(body)) throw new Error(body.error ?? "提醒设置保存失败");
      onSaved(body);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "提醒设置保存失败");
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal reminder-manager-modal" role="dialog" aria-modal="true" aria-labelledby="reminder-manager-title">
        <div className="modal-head"><div><span className="modal-kicker">RENEWAL REMINDERS</span><h2 id="reminder-manager-title">批量管理到期提醒</h2></div><button onClick={onClose} aria-label="关闭"><X size={19} /></button></div>
        <div className="reminder-manager-summary">
          <div><BellRing size={18} /><span><strong>到期前 1 天发送邮件</strong><small>已开启 {enabledIds.size} / {eligible.length}</small></span></div>
          <div><button type="button" onClick={() => setEnabledIds(new Set(eligible.map((item) => item.id)))} disabled={enabledIds.size === eligible.length}>全部开启</button><button type="button" onClick={() => setEnabledIds(new Set())} disabled={!enabledIds.size}>全部关闭</button></div>
        </div>
        <form className="reminder-manager-form" onSubmit={save}>
          <div className="reminder-manager-list" aria-label="可设置提醒的订阅">
            {eligible.map((item) => (
              <label className="reminder-manager-row" key={item.id}>
                <BrandIcon iconId={item.iconId} iconKey={item.iconKey} accent={item.accent} size={40} />
                <span><strong>{item.name}</strong><small>{item.groupName} · {item.dueDate ? formatSubscriptionDate(item.dueDate) : "未设置日期"}</small></span>
                <input type="checkbox" checked={enabledIds.has(item.id)} onChange={() => toggle(item.id)} aria-label={`${item.name} 到期提醒`} />
                <i aria-hidden="true" />
              </label>
            ))}
          </div>
          <p className="reminder-manager-note">永久订阅不会发送到期提醒。保存后只更新这里发生变化的订阅。</p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="modal-actions"><button type="button" onClick={onClose}>取消</button><button className="save-button" disabled={saving || !changed.length}>{saving ? "正在保存…" : `保存${changed.length ? ` ${changed.length} 项` : ""}`}</button></div>
        </form>
      </section>
    </div>
  );
}

function UserAvatar({ name, image, size }: { name: string; image: string | null; size: number }) {
  return (
    <span className="user-avatar" style={{ width: size, height: size }} aria-hidden="true">
      {image ? <Image src={image} alt="" width={size} height={size} unoptimized /> : name.trim().slice(0, 1).toUpperCase() || "T"}
    </span>
  );
}

async function prepareAvatar(file: File) {
  if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(file.type)) throw new Error("请选择 PNG、JPEG 或 WebP 图片");
  if (file.size > 8 * 1024 * 1024) throw new Error("原图不能超过 8 MB");
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const sourceX = Math.floor((bitmap.width - side) / 2);
    const sourceY = Math.floor((bitmap.height - side) / 2);
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器无法处理头像");
    context.drawImage(bitmap, sourceX, sourceY, side, side, 0, 0, 256, 256);
    const dataUrl = canvas.toDataURL("image/webp", 0.84);
    if (!dataUrl.startsWith("data:image/")) throw new Error("头像处理失败");
    return dataUrl;
  } finally {
    bitmap.close();
  }
}

function ProfileModal({ name, image, onClose, onSaved }: { name: string; image: string | null; onClose: () => void; onSaved: (profile: ProfileRecord) => void }) {
  const [draftName, setDraftName] = useState(name);
  const [preview, setPreview] = useState<string | null>(image);
  const [avatarPatch, setAvatarPatch] = useState<string | null | undefined>(undefined);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  useModalBehavior(onClose);

  async function chooseAvatar(file: File | undefined) {
    if (!file) return;
    setProcessing(true);
    setError("");
    try {
      const dataUrl = await prepareAvatar(file);
      setPreview(dataUrl);
      setAvatarPatch(dataUrl);
    } catch (avatarError) {
      setError(avatarError instanceof Error ? avatarError.message : "头像处理失败");
    } finally {
      setProcessing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draftName, ...(avatarPatch !== undefined ? { image: avatarPatch } : {}) }),
      });
      const body = await response.json() as ProfileRecord & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "资料保存失败");
      onSaved(body);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "资料保存失败");
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title">
        <div className="modal-head"><div><span className="modal-kicker">PROFILE</span><h2 id="profile-title">编辑资料</h2></div><button onClick={onClose} aria-label="关闭"><X size={19} /></button></div>
        <form className="profile-form" onSubmit={save}>
          <div className="profile-avatar-editor">
            <UserAvatar name={draftName || name} image={preview} size={78} />
            <div><strong>头像</strong><span>自动裁剪为正方形，最大保存 512 KB</span><div><button type="button" onClick={() => fileRef.current?.click()} disabled={processing}><Camera size={15} />{processing ? "处理中…" : "选择图片"}</button>{preview && <button type="button" onClick={() => { setPreview(null); setAvatarPatch(null); }}>移除</button>}</div></div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void chooseAvatar(event.target.files?.[0])} />
          </div>
          <label><span>昵称</span><input value={draftName} onChange={(event) => setDraftName(event.target.value)} required maxLength={48} autoComplete="name" /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="modal-actions"><button type="button" onClick={onClose}>取消</button><button className="save-button" disabled={saving || processing}>{saving ? "正在保存…" : "保存资料"}</button></div>
        </form>
      </section>
    </div>
  );
}

function SubscriptionTile({ item, nearest, onOpen }: { item: SubscriptionRecord; nearest: boolean; onOpen: () => void }) {
  const surface = useResolvedSubscriptionAccent(item);
  return (
    <article className={`renewal-tile ${nearest ? "nearest" : ""}`} style={subscriptionSurfaceStyle(surface.accent)}>
      <button className="tile-open" onClick={onOpen} aria-label={`查看并编辑 ${item.name}`} />
      <div className="tile-top">
        <BrandIcon iconId={item.iconId} iconKey={item.iconKey} accent={item.accent} size={56} onColorResolved={surface.onColorResolved} />
        <div className="tile-status"><span className={(daysUntil(item.dueDate) ?? 99) <= 7 ? "urgent" : ""}>{urgencyLabel(item)}</span></div>
      </div>
      <div className="tile-copy">
        <h3>{item.name}</h3>
        <p>{item.groupName}</p>
        <strong>{formatMoney(item)}</strong>
      </div>
      <div className="tile-bottom">
        <span><CalendarDays size={16} />{formatDueDate(item)}</span>
        <span className="billing-cycle">{billingCycleLabel(item.billingCycle)}</span>
      </div>
    </article>
  );
}

function AddSubscriptionModal({ categories, reminderEligible, onClose, onSaved }: { categories: string[]; reminderEligible: boolean; onClose: () => void; onSaved: (record: SubscriptionRecord) => void }) {
  useModalBehavior(onClose);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal subscription-modal" role="dialog" aria-modal="true" aria-labelledby="add-title">
        <div className="modal-head"><div><span className="modal-kicker">NEW SUBSCRIPTION</span><h2 id="add-title">添加一个订阅</h2></div><button onClick={onClose} aria-label="关闭"><X size={20} /></button></div>
        <SubscriptionForm categories={categories} reminderEligible={reminderEligible} onCancel={onClose} onSaved={onSaved} />
      </section>
    </div>
  );
}

function SubscriptionDetailModal({ item, categories, reminderEligible, onClose, onSaved, onDeleted }: { item: SubscriptionRecord; categories: string[]; reminderEligible: boolean; onClose: () => void; onSaved: (record: SubscriptionRecord) => void; onDeleted: (id: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const closeDetail = useCallback(() => {
    if (!deleting) onClose();
  }, [deleting, onClose]);
  useModalBehavior(closeDetail);
  const surface = useResolvedSubscriptionAccent(item);
  const surfaceStyle = subscriptionSurfaceStyle(surface.accent);

  useEffect(() => {
    if (confirmingDelete) deleteCancelRef.current?.focus();
  }, [confirmingDelete]);

  async function renew() {
    setRenewing(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/subscriptions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "续费更新失败");
      onSaved(body);
      setMessage(`已标记续费，下次日期为 ${formatDueDate(body)}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "续费更新失败");
    } finally {
      setRenewing(false);
    }
  }

  async function remove() {
    setDeleting(true);
    setError("");
    try {
      const response = await fetch(`/api/subscriptions/${encodeURIComponent(item.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: item.id }),
      });
      const body = await response.json() as { deleted?: { id: string }; error?: string };
      if (!response.ok || body.deleted?.id !== item.id) throw new Error(body.error ?? "删除失败，请刷新后重试");
      onDeleted(item.id);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "删除失败");
      setDeleting(false);
    }
  }

  return (
    <div className="modal-backdrop detail-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeDetail()}>
      <section className={`modal detail-modal ${editing ? "editing" : ""}`} role="dialog" aria-modal="true" aria-labelledby="detail-title">
        <div className="detail-head" style={surfaceStyle}>
          <div className="detail-title-wrap">
            <BrandIcon iconId={item.iconId} iconKey={item.iconKey} accent={item.accent} size={62} onColorResolved={surface.onColorResolved} />
            <div><span>{editing ? "编辑订阅" : item.groupName}</span><h2 id="detail-title">{item.name}</h2></div>
          </div>
          <button className="detail-close" onClick={closeDetail} aria-label="关闭" disabled={deleting}><X size={20} /></button>
        </div>

        {editing ? (
          <SubscriptionForm
            initial={item}
            categories={categories}
            reminderEligible={reminderEligible}
            onCancel={() => setEditing(false)}
            onSaved={(updated) => { onSaved(updated); setEditing(false); setMessage("订阅信息已更新"); }}
          />
        ) : (
          <>
            <div className="detail-amount"><span>费用</span><strong>{formatMoney(item)}</strong></div>
            <dl className="detail-grid">
              <div><dt>周期</dt><dd>{billingCycleLabel(item.billingCycle)}</dd></div>
              <div><dt>{item.billingCycle === "custom" ? "到期日期" : "下次续费"}</dt><dd>{formatDueDate(item)}</dd></div>
              <div><dt>分类</dt><dd>{item.groupName}</dd></div>
              <div><dt>币种</dt><dd>{item.currencyCode}</dd></div>
              {reminderEligible && <div className="detail-wide"><dt>邮件提醒</dt><dd className={item.reminderEnabled ? "detail-reminder-on" : "detail-empty"}>{item.reminderEnabled ? <><BellRing size={14} />到期前 1 天</> : "未开启"}</dd></div>}
              <div className="detail-wide"><dt>账号</dt><dd className={item.accountName ? "" : "detail-empty"}>{item.accountName || "未记录"}</dd></div>
              {item.website && <div className="detail-wide"><dt>官网</dt><dd><a href={item.website} target="_blank" rel="noreferrer">打开官网 <ExternalLink size={13} /></a></dd></div>}
              <div className="detail-wide"><dt>备注</dt><dd className={item.notes ? "" : "detail-empty"}>{item.notes || "暂无备注"}</dd></div>
            </dl>
            {confirmingDelete ? (
              <div className="detail-delete-confirm" role="alert" aria-live="assertive">
                <div><strong>删除“{item.name}”？</strong><p>删除后无法恢复，相关的提醒记录也会一并移除。</p></div>
                {error && <p className="detail-delete-error">{error}</p>}
                <div className="detail-delete-actions">
                  <button ref={deleteCancelRef} type="button" onClick={() => { setConfirmingDelete(false); setError(""); }} disabled={deleting}>取消</button>
                  <button className="delete-confirm-button" type="button" onClick={() => void remove()} disabled={deleting}><Trash2 size={15} />{deleting ? "正在删除…" : "确认删除"}</button>
                </div>
              </div>
            ) : (
              <>
                <p className={`detail-feedback ${error ? "error" : ""}`} aria-live="polite">{error || message}</p>
                <div className="detail-actions">
                  <button className="delete-detail-button" onClick={() => { setConfirmingDelete(true); setMessage(""); setError(""); }}><Trash2 size={15} />删除订阅</button>
                  {isAutoRenewableCycle(item.billingCycle) && <button className="renew-detail-button" onClick={renew} disabled={renewing}><Check size={15} />{renewing ? "正在更新…" : "标记已续费"}</button>}
                  <button className="save-button" onClick={() => { setEditing(true); setMessage(""); setError(""); }}><Pencil size={15} />编辑订阅</button>
                </div>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function SubscriptionForm({ initial, categories, reminderEligible, onCancel, onSaved }: { initial?: SubscriptionRecord; categories: string[]; reminderEligible: boolean; onCancel: () => void; onSaved: (record: SubscriptionRecord) => void }) {
  const [icon, setIcon] = useState<BrandChoice>(() => initialBrand(initial));
  const [billingCycle, setBillingCycle] = useState(initial?.billingCycle ?? "monthly");
  const [currencyCode, setCurrencyCode] = useState(initial?.currencyCode ?? "CNY");
  const [website, setWebsite] = useState(initial?.website ?? "");
  const [cardAccent, setCardAccent] = useState(initial?.cardAccent ? `#${initial.cardAccent}` : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const rawAmount = String(form.get("amount") ?? "").trim();
    const amount = rawAmount ? Number(rawAmount) : null;
    if (!icon.iconId) {
      setError("请选择图标");
      setSaving(false);
      return;
    }
    if (amount != null && (!Number.isFinite(amount) || amount < 0)) {
      setError("请输入有效金额");
      setSaving(false);
      return;
    }

    const response = await fetch(initial ? `/api/subscriptions/${initial.id}` : "/api/subscriptions", {
      method: initial ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        groupName: form.get("groupName"),
        dueDate: billingCycle === "lifetime" ? null : form.get("dueDate"),
        amountMinor: amount == null ? null : majorToMinor(amount, currencyCode),
        currencyCode,
        billingCycle,
        iconId: icon.iconId,
        iconKey: icon.iconKey,
        accent: icon.accent,
        cardAccent: cardAccent || null,
        accountName: form.get("accountName"),
        website,
        notes: form.get("notes"),
        reminderEnabled: reminderEligible && billingCycle !== "lifetime" && form.get("reminderEnabled") === "on",
      }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error ?? (initial ? "更新失败" : "保存失败"));
      setSaving(false);
      return;
    }
    onSaved(body);
  }

  return (
    <form className="subscription-form" onSubmit={submit}>
      <label><span>服务名称</span><input name="name" required autoFocus defaultValue={initial?.name ?? ""} placeholder="例如：YouTube Premium" /></label>
      <BrandPicker value={icon} onChange={setIcon} website={website} onWebsiteChange={setWebsite} />
      <fieldset className="card-accent-field">
        <legend><span>卡片色调</span><small>{cardAccent ? "自定义" : "跟随图标"}</small></legend>
        <div className="card-accent-options">
          <button
            type="button"
            className={`card-accent-auto ${cardAccent ? "" : "selected"}`}
            style={subscriptionSurfaceStyle(icon.accent)}
            onClick={() => setCardAccent("")}
            aria-pressed={!cardAccent}
          >
            <span aria-hidden="true" />
            跟随图标
          </button>
          {cardAccentPresets.map((accent) => (
            <button
              key={accent}
              type="button"
              className={`card-accent-swatch ${cardAccent.toLowerCase() === accent ? "selected" : ""}`}
              style={subscriptionSurfaceStyle(accent)}
              onClick={() => setCardAccent(accent)}
              aria-label={`使用色调 ${accent}`}
              aria-pressed={cardAccent.toLowerCase() === accent}
            />
          ))}
          <label className={`card-accent-custom ${cardAccent && !cardAccentPresets.includes(cardAccent.toLowerCase()) ? "selected" : ""}`}>
            <input
              type="color"
              value={cardAccent || normalizedIconColor(icon.accent)}
              onChange={(event) => setCardAccent(event.target.value.toLowerCase())}
              aria-label="选择自定义卡片色调"
            />
            <span aria-hidden="true" style={{ background: cardAccent || normalizedIconColor(icon.accent) }} />
            <em>自定义</em>
          </label>
        </div>
      </fieldset>

      <div className="form-grid">
        <label><span>分类</span><input name="groupName" list="subscription-category-options" required defaultValue={initial?.groupName ?? ""} placeholder="选择或输入新分类" /><datalist id="subscription-category-options">{categories.map((category) => <option key={category} value={category} />)}</datalist></label>
        {billingCycle === "lifetime" ? (
          <div className="lifetime-field"><span>有效期</span><strong>永久有效，无需设置日期</strong></div>
        ) : (
          <DateField
            label={billingCycle === "custom" ? "到期日期" : "续费日期"}
            name="dueDate"
            required
            defaultValue={initial?.dueDate ?? defaultDueDate()}
          />
        )}
      </div>

      <div className="form-grid amount-grid">
        <label><span>金额</span><input name="amount" type="number" min="0" step={10 ** -currencyFractionDigits(currencyCode)} defaultValue={editableAmount(initial)} placeholder="0.00" /></label>
        <label><span>币种</span><select name="currencyCode" value={currencyCode} onChange={(event) => setCurrencyCode(event.target.value)}>{currencyOptions.map((option) => <option key={option.value} value={option.value}>{option.value} · {option.label}</option>)}</select></label>
        <label><span>周期</span><select name="billingCycle" value={billingCycle} onChange={(event) => setBillingCycle(event.target.value)}>{billingCycleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      </div>
      <label><span>账号 <em>选填</em></span><input name="accountName" maxLength={160} defaultValue={initial?.accountName ?? ""} placeholder="邮箱、用户名或会员号（请勿填写密码）" /></label>
      <label><span>备注 <em>选填</em></span><textarea name="notes" rows={3} maxLength={1000} defaultValue={initial?.notes ?? ""} placeholder="记录套餐或续费说明" /></label>
      {reminderEligible && billingCycle !== "lifetime" && (
        <label className="reminder-toggle">
          <input name="reminderEnabled" type="checkbox" defaultChecked={initial?.reminderEnabled ?? false} />
          <span aria-hidden="true" />
          <BellRing size={17} />
          <div><strong>到期前 1 天邮件提醒</strong><small>每天上午检查一次，单个到期日只发送一封。</small></div>
        </label>
      )}
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions"><button type="button" onClick={onCancel}>取消</button><button className="save-button" disabled={saving}>{saving ? "正在保存…" : initial ? "保存修改" : "保存订阅"}</button></div>
    </form>
  );
}

function CategoryManagerModal({ groups, onClose, onCreated, onDeleted, onReordered }: { groups: CategoryGroup[]; onClose: () => void; onCreated: (name: string) => void; onDeleted: (result: CategoryDeleteResult) => void; onReordered: (names: string[]) => void }) {
  const [draft, setDraft] = useState(groups);
  const [draggedName, setDraggedName] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ name: string; edge: "before" | "after" } | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [orderMessage, setOrderMessage] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [replacement, setReplacement] = useState("其他");
  const [error, setError] = useState("");
  const targetGroup = draft.find((group) => group.name === deleteTarget);
  useModalBehavior(onClose);

  async function persistOrder(next: CategoryGroup[], previous: CategoryGroup[], movedName: string) {
    setDraft(next);
    setSavingOrder(true);
    setError("");
    setOrderMessage("正在保存分类顺序…");
    try {
      const response = await fetch("/api/categories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names: next.map((group) => group.name) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "保存分类顺序失败");
      onReordered(body.names);
      setOrderMessage(`${movedName} 的位置已保存`);
    } catch (orderError) {
      setDraft(previous);
      setOrderMessage("");
      setError(orderError instanceof Error ? orderError.message : "保存分类顺序失败");
    } finally {
      setSavingOrder(false);
    }
  }

  function moveCategory(name: string, direction: -1 | 1) {
    if (savingOrder) return;
    const index = draft.findIndex((group) => group.name === name);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= draft.length) return;
    const next = [...draft];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    void persistOrder(next, draft, name);
  }

  function dropCategory(targetName: string, edge: "before" | "after") {
    if (!draggedName || draggedName === targetName || savingOrder) return;
    const previous = draft;
    const next = [...draft];
    const from = next.findIndex((group) => group.name === draggedName);
    if (from < 0) return;
    const [dragged] = next.splice(from, 1);
    const target = next.findIndex((group) => group.name === targetName);
    const insertion = target < 0 ? next.length : target + (edge === "after" ? 1 : 0);
    next.splice(insertion, 0, dragged);
    setDraggedName(null);
    setDropTarget(null);
    void persistOrder(next, previous, dragged.name);
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError("");
    const form = event.currentTarget;
    const name = String(new FormData(form).get("name") ?? "");
    const response = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error ?? "创建失败");
      setCreating(false);
      return;
    }
    setDraft((current) => current.some((group) => group.name === body.name) ? current : [...current, { name: body.name, count: 0 }]);
    onCreated(body.name);
    form.reset();
    setCreating(false);
  }

  async function removeCategory() {
    if (!deleteTarget) return;
    setDeleting(true);
    setError("");
    const response = await fetch("/api/categories", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: deleteTarget, replacement }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error ?? "删除失败");
      setDeleting(false);
      return;
    }
    setDraft((current) => {
      const next = current.filter((group) => group.name !== body.name);
      if (!body.replacement) return next;
      const replacementIndex = next.findIndex((group) => group.name === body.replacement);
      if (replacementIndex < 0) return [...next, { name: body.replacement, count: body.moved }];
      return next.map((group, index) => index === replacementIndex ? { ...group, count: group.count + body.moved } : group);
    });
    onDeleted(body);
    setDeleteTarget(null);
    setReplacement("其他");
    setDeleting(false);
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal category-manager" role="dialog" aria-modal="true" aria-labelledby="category-title">
        <div className="modal-head"><div><span className="modal-kicker">CATEGORIES</span><h2 id="category-title">管理分类</h2></div><button onClick={onClose} aria-label="关闭"><X size={19} /></button></div>
        <p className="category-order-help">拖动左侧手柄调整分类顺序，移动后自动保存。</p>
        <form className="category-create" onSubmit={create}>
          <label><span>新分类</span><input name="name" required maxLength={30} placeholder="例如：家庭共享" /></label>
          <button className="save-button" disabled={creating}><Plus size={15} />{creating ? "创建中" : "创建"}</button>
        </form>

        <div className={`category-list ${draggedName ? "drag-active" : ""}`} aria-label="已有分类">
          {draft.map((group, index) => (
            <div
              className={`category-row ${deleteTarget === group.name ? "deleting" : ""} ${draggedName === group.name ? "dragging" : ""} ${dropTarget?.name === group.name ? `drop-${dropTarget.edge}` : ""}`}
              key={group.name}
              onDragOver={(event) => {
                if (!draggedName || draggedName === group.name) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                const bounds = event.currentTarget.getBoundingClientRect();
                const edge = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
                if (dropTarget?.name !== group.name || dropTarget.edge !== edge) setDropTarget({ name: group.name, edge });
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null) && dropTarget?.name === group.name) setDropTarget(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                dropCategory(group.name, dropTarget?.name === group.name ? dropTarget.edge : "before");
              }}
            >
              <div className="category-row-main">
                <span className="category-grip" draggable={!savingOrder && !deleteTarget} onDragStart={(event: DragEvent<HTMLSpanElement>) => { setDraggedName(group.name); setDropTarget(null); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", group.name); }} onDragEnd={() => { setDraggedName(null); setDropTarget(null); }} aria-label={`拖动分类 ${group.name}`}><GripVertical size={17} /></span>
                <div><strong>{group.name}</strong><span>{group.count} 项订阅</span></div>
                <span className="category-row-actions">
                  <button type="button" onClick={() => moveCategory(group.name, -1)} disabled={savingOrder || index === 0} aria-label={`上移分类 ${group.name}`}><MoveUp size={15} /></button>
                  <button type="button" onClick={() => moveCategory(group.name, 1)} disabled={savingOrder || index === draft.length - 1} aria-label={`下移分类 ${group.name}`}><MoveDown size={15} /></button>
                  {group.name !== "其他" && <button type="button" onClick={() => { setDeleteTarget(group.name); setReplacement("其他"); setError(""); }} aria-label={`删除分类 ${group.name}`}><Trash2 size={15} /></button>}
                </span>
              </div>
              {deleteTarget === group.name && (
                <div className="category-delete-confirm">
                  <p>{group.count > 0 ? `删除后，${group.count} 项订阅将移动到：` : "这个分类为空，可以直接删除。"}</p>
                  {group.count > 0 && (
                    <select value={replacement} onChange={(event) => setReplacement(event.target.value)} aria-label="订阅迁移到">
                      <option value="其他">其他</option>
                      {draft.filter((item) => item.name !== group.name && item.name !== "其他").map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
                    </select>
                  )}
                  <div><button onClick={() => setDeleteTarget(null)}>取消</button><button className="danger-button" onClick={removeCategory} disabled={deleting}>{deleting ? "删除中" : "确认删除"}</button></div>
                </div>
              )}
            </div>
          ))}
          {!draft.length && <div className="category-list-empty">还没有分类</div>}
        </div>
        <p className="category-order-message" aria-live="polite">{orderMessage}</p>
        {targetGroup && targetGroup.count > 0 && <span className="category-safety-note">订阅本身不会被删除。</span>}
        {error && <p className="form-error">{error}</p>}
      </section>
    </div>
  );
}

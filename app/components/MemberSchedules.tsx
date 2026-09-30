"use client";

import { useState } from "react";
import { BellRing, Check, Plus, Trash2, UsersRound } from "lucide-react";
import type { SubscriptionRecord } from "../../db/subscriptions";
import { memberIntervalLabel, type MemberSchedule, type MemberIntervalUnit } from "../../lib/member-schedules";
import { currencyFractionDigits, currencyOptions, majorToMinor, minorToMajor, type SupportedCurrency } from "../../lib/subscription-options";
import { formatCurrencyAmount, formatSubscriptionDate } from "../../lib/subscription-display";
import { DateField } from "./DateField";

export type MemberScheduleDraft = Omit<MemberSchedule, "amountMinor" | "anchorDay"> & { amount: string };

type Payment = {
  id: string;
  memberId: string;
  memberName: string;
  scheduledDueDate: string;
  amountMinor: number;
  currencyCode: string;
  collectedAt: string;
};

function money(amountMinor: number, currencyCode: string) {
  return formatCurrencyAmount(minorToMajor(amountMinor, currencyCode), currencyCode, currencyFractionDigits(currencyCode));
}

export function schedulesToDrafts(schedules: MemberSchedule[]): MemberScheduleDraft[] {
  return schedules.map((schedule) => ({
    id: schedule.id,
    name: schedule.name,
    joinedDate: schedule.joinedDate,
    amount: String(minorToMajor(schedule.amountMinor, schedule.currencyCode)),
    currencyCode: schedule.currencyCode,
    nextDueDate: schedule.nextDueDate,
    intervalCount: schedule.intervalCount,
    intervalUnit: schedule.intervalUnit,
    reminderEnabled: schedule.reminderEnabled ?? false,
    lastCollectedAt: schedule.lastCollectedAt,
  }));
}

export function draftsToSchedules(drafts: MemberScheduleDraft[]) {
  return drafts.map((draft) => ({
    id: draft.id || undefined,
    name: draft.name,
    joinedDate: draft.joinedDate,
    amountMinor: majorToMinor(Number(draft.amount), draft.currencyCode),
    currencyCode: draft.currencyCode,
    nextDueDate: draft.nextDueDate,
    intervalCount: draft.intervalCount,
    intervalUnit: draft.intervalUnit,
    reminderEnabled: draft.reminderEnabled,
    lastCollectedAt: draft.lastCollectedAt,
  }));
}

export function MemberSchedulesFields({ value, onChange, currencyCode, dueDate, reminderEligible }: {
  value: MemberScheduleDraft[];
  onChange: (value: MemberScheduleDraft[]) => void;
  currencyCode: string;
  dueDate: string;
  reminderEligible: boolean;
}) {
  function addMember() {
    onChange([...value, {
      id: "",
      name: "",
      joinedDate: null,
      amount: "",
      currencyCode: currencyCode as SupportedCurrency,
      nextDueDate: dueDate,
      intervalCount: 1,
      intervalUnit: "month",
      reminderEnabled: false,
      lastCollectedAt: null,
    }]);
  }

  function updateMember(index: number, patch: Partial<MemberScheduleDraft>) {
    onChange(value.map((member, position) => position === index ? { ...member, ...patch } : member));
  }

  return (
    <section className="member-schedules-editor" aria-label="成员收款安排">
      <div className="member-schedules-editor-head">
        <div><strong><UsersRound size={16} aria-hidden="true" />成员收款</strong><p>{reminderEligible ? "分别记录金额和周期；同日邮件合并发至账号邮箱。" : "为每个人单独记录金额和续费周期。"}</p></div>
        <button type="button" onClick={addMember} disabled={value.length >= 20}><Plus size={15} />添加成员</button>
      </div>
      {value.length > 0 && <div className="member-schedules-editor-list">{value.map((member, index) => (
        <div className="member-schedule-editor" key={member.id || `new-${index}`}>
          <div className="member-schedule-editor-top"><strong>成员 {index + 1}</strong><button type="button" aria-label={`移除成员 ${member.name || index + 1}`} onClick={() => onChange(value.filter((_, position) => position !== index))}><Trash2 size={15} /></button></div>
          <div className="member-schedule-form-grid">
            <label><span>称呼</span><input required maxLength={80} value={member.name} placeholder="例如：家人 A" onChange={(event) => updateMember(index, { name: event.target.value })} /></label>
            <DateField label="加入日期" optional value={member.joinedDate ?? ""} onChange={(date) => updateMember(index, { joinedDate: date || null })} />
            <label><span>每次收款</span><input required type="number" min="0" step={10 ** -currencyFractionDigits(member.currencyCode)} value={member.amount} placeholder="0.00" onChange={(event) => updateMember(index, { amount: event.target.value })} /></label>
            <label><span>币种</span><select value={member.currencyCode} onChange={(event) => updateMember(index, { currencyCode: event.target.value as SupportedCurrency })}>{currencyOptions.map((option) => <option key={option.value} value={option.value}>{option.value} · {option.label}</option>)}</select></label>
            <DateField label="下次收款日期" required value={member.nextDueDate} onChange={(date) => updateMember(index, { nextDueDate: date })} />
            <div className="member-schedule-interval"><span>收款周期</span><div><input aria-label={`${member.name || `成员 ${index + 1}`} 的周期数`} type="number" required min="1" max={{ day: 3650, week: 520, month: 120, year: 10 }[member.intervalUnit]} value={member.intervalCount} onChange={(event) => updateMember(index, { intervalCount: Number(event.target.value) })} /><select aria-label={`${member.name || `成员 ${index + 1}`} 的周期单位`} value={member.intervalUnit} onChange={(event) => updateMember(index, { intervalUnit: event.target.value as MemberIntervalUnit })}><option value="day">天</option><option value="week">周</option><option value="month">月</option><option value="year">年</option></select></div></div>
          </div>
          {reminderEligible && <label className="member-reminder-toggle"><input type="checkbox" checked={member.reminderEnabled} onChange={(event) => updateMember(index, { reminderEnabled: event.target.checked })} /><BellRing size={14} aria-hidden="true" /><span>收款前 1 天邮件提醒我</span></label>}
        </div>
      ))}</div>}
    </section>
  );
}

export function MemberSchedulesDetails({ subscriptionId, schedules, onSaved, reminderEligible }: {
  subscriptionId: string;
  schedules: MemberSchedule[];
  onSaved: (record: SubscriptionRecord) => void;
  reminderEligible: boolean;
}) {
  const [collectingId, setCollectingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [payments, setPayments] = useState<Payment[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState("");

  async function collect(member: MemberSchedule) {
    setCollectingId(member.id);
    setFeedback("");
    try {
      const response = await fetch(`/api/subscriptions/${encodeURIComponent(subscriptionId)}/members/${encodeURIComponent(member.id)}/collect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedDueDate: member.nextDueDate }),
      });
      const body = await response.json() as { subscription?: SubscriptionRecord; payment?: Payment; error?: string };
      if (!response.ok || !body.subscription || !body.payment) throw new Error(body.error ?? "收款记录保存失败");
      onSaved(body.subscription);
      if (historyLoaded) setPayments((current) => [body.payment!, ...current]);
      setFeedback(`${member.name} 已记录收款，下次为 ${formatSubscriptionDate(body.subscription.memberSchedules.find((item) => item.id === member.id)?.nextDueDate ?? member.nextDueDate)}`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "收款记录保存失败");
    } finally {
      setCollectingId(null);
    }
  }

  async function loadHistory(cursor?: string) {
    if (loadingHistory || (historyLoaded && !cursor)) return;
    setLoadingHistory(true);
    setHistoryError("");
    try {
      const path = `/api/subscriptions/${encodeURIComponent(subscriptionId)}/member-payments`;
      const response = await fetch(cursor ? `${path}?cursor=${encodeURIComponent(cursor)}` : path);
      const body = await response.json() as { payments?: Payment[]; nextCursor?: string | null; error?: string };
      if (!response.ok || !body.payments) throw new Error(body.error ?? "收款记录加载失败");
      setPayments((current) => cursor ? [...current, ...body.payments!] : body.payments!);
      setNextCursor(body.nextCursor ?? null);
      setHistoryLoaded(true);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : "收款记录加载失败");
    } finally {
      setLoadingHistory(false);
    }
  }

  return (
    <section className="member-schedules-details" aria-label="成员收款安排">
      <div className="member-schedules-details-head"><strong><UsersRound size={16} aria-hidden="true" />成员收款</strong><span>{schedules.length} 位成员</span></div>
      {schedules.length === 0 && <p className="member-schedules-empty">当前没有成员安排，仍可查看此前的收款记录。</p>}
      {schedules.length > 0 && <div className="member-schedules-list">{schedules.map((member) => (
        <div className="member-schedule-row" key={member.id}>
          <div className="member-schedule-identity"><strong>{member.name}</strong><small>{member.joinedDate ? `${member.joinedDate.replaceAll("-", "/")} 加入 · ` : ""}{memberIntervalLabel(member.intervalCount, member.intervalUnit)}{member.reminderEnabled && reminderEligible ? " · 提前 1 天邮件提醒" : ""}</small></div>
          <div className="member-schedule-payment"><strong>{money(member.amountMinor, member.currencyCode)}</strong><small>下次 {formatSubscriptionDate(member.nextDueDate)}</small></div>
          <button type="button" onClick={() => void collect(member)} disabled={collectingId !== null}><Check size={14} />{collectingId === member.id ? "保存中…" : "标记已收款"}</button>
        </div>
      ))}</div>}
      {feedback && <p className="member-schedules-feedback" role="status">{feedback}</p>}
      <details className="member-payment-history" onToggle={(event) => { if (event.currentTarget.open) void loadHistory(); }}>
        <summary>收款记录</summary>
        {historyError && <p role="alert">{historyError} <button type="button" onClick={() => void loadHistory(nextCursor ?? undefined)}>重试</button></p>}
        {loadingHistory && !historyLoaded && <p>正在加载…</p>}
        {historyLoaded && payments.length === 0 && <p>暂无记录</p>}
        {payments.length > 0 && <div>{payments.map((payment) => <div key={payment.id}><span><strong>{payment.memberName}</strong><small>{new Date(payment.collectedAt).toLocaleString("zh-CN")} 已收 · 应收 {payment.scheduledDueDate.replaceAll("-", "/")}</small></span><strong>{money(payment.amountMinor, payment.currencyCode)}</strong></div>)}</div>}
        {nextCursor && <button className="member-history-more" type="button" disabled={loadingHistory} onClick={() => void loadHistory(nextCursor)}>{loadingHistory ? "加载中…" : "加载更早记录"}</button>}
      </details>
    </section>
  );
}

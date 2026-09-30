import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceMemberDueDate,
  memberIntervalLabel,
  normalizeMemberSchedules,
} from "../lib/member-schedules.ts";

function schedule(overrides = {}) {
  return {
    name: "家庭成员 A",
    joinedDate: "2028-02-29",
    amountMinor: 3180,
    currencyCode: "CNY",
    nextDueDate: "2028-03-31",
    intervalCount: 2,
    intervalUnit: "month",
    ...overrides,
  };
}

test("normalizes independent collection schedules and preserves server payment timestamps", () => {
  const [created] = normalizeMemberSchedules([schedule({ name: "  家庭   成员 A  ", currencyCode: "php" })]);
  assert.match(created.id, /^[0-9a-f-]{36}$/);
  assert.equal(created.name, "家庭 成员 A");
  assert.equal(created.currencyCode, "PHP");
  assert.equal(created.anchorDay, 31);
  assert.equal(created.reminderEnabled, false);
  assert.equal(created.lastCollectedAt, null);

  assert.equal(normalizeMemberSchedules([schedule({ reminderEnabled: true })])[0].reminderEnabled, false);
  assert.equal(normalizeMemberSchedules([schedule({ reminderEnabled: true })], [], true)[0].reminderEnabled, true);
  const optedIn = normalizeMemberSchedules([schedule({ reminderEnabled: true })], [], true)[0];
  assert.equal(normalizeMemberSchedules([optedIn], [optedIn], false)[0].reminderEnabled, true);
  assert.equal(normalizeMemberSchedules([{ ...optedIn, reminderEnabled: false }], [optedIn], false)[0].reminderEnabled, false);

  const paid = { ...created, lastCollectedAt: "2028-03-31T08:30:00.000Z" };
  const [edited] = normalizeMemberSchedules([{ ...paid, name: "家庭成员 B", amountMinor: 4000 }], [paid]);
  assert.equal(edited.id, paid.id);
  assert.equal(edited.anchorDay, 31);
  assert.equal(edited.lastCollectedAt, paid.lastCollectedAt);
  const editable = { ...paid };
  delete editable.anchorDay;
  const [rescheduled] = normalizeMemberSchedules([{ ...editable, nextDueDate: "2028-04-15" }], [paid]);
  assert.equal(rescheduled.anchorDay, 15);
  assert.throws(() => normalizeMemberSchedules([{ ...paid, lastCollectedAt: null }], [paid]), /状态已变化/);
  const withoutVersion = { ...paid };
  delete withoutVersion.lastCollectedAt;
  assert.throws(() => normalizeMemberSchedules([withoutVersion], [paid]), /状态已变化/);
  assert.throws(() => normalizeMemberSchedules([{ ...paid, anchorDay: 1 }], [paid]), /锚定日期.*不能手动修改/);
  assert.throws(() => normalizeMemberSchedules([{ ...schedule(), lastCollectedAt: "2028-03-31T08:30:00.000Z" }]), /不能手动修改/);
});

test("rejects malformed dates, currencies, duplicates, amounts and intervals", () => {
  assert.throws(() => normalizeMemberSchedules(null), /最多 20/);
  assert.throws(() => normalizeMemberSchedules([schedule({ joinedDate: "2028-02-30" })]), /加入日期.*格式/);
  assert.throws(() => normalizeMemberSchedules([schedule({ nextDueDate: "2028-13-01" })]), /下次收款日期.*格式/);
  assert.throws(() => normalizeMemberSchedules([schedule({ amountMinor: -1 })]), /金额不正确/);
  assert.throws(() => normalizeMemberSchedules([schedule({ amountMinor: 2_147_483_648 })]), /金额不正确/);
  assert.throws(() => normalizeMemberSchedules([schedule({ currencyCode: "XYZ" })]), /币种不受支持/);
  assert.throws(() => normalizeMemberSchedules([schedule({ intervalCount: 0 })]), /周期/);
  assert.throws(() => normalizeMemberSchedules([schedule({ intervalCount: 121 })]), /周期/);
  assert.throws(() => normalizeMemberSchedules([schedule({ intervalUnit: "quarter" })]), /周期单位/);
  assert.throws(() => normalizeMemberSchedules([schedule({ reminderEnabled: "yes" })]), /邮件提醒设置/);
  assert.throws(() => normalizeMemberSchedules([schedule({ name: " " })]), /成员名称/);
  assert.throws(() => normalizeMemberSchedules([schedule(), schedule({ name: "家庭成员 a" })]), /名称不能重复/);
  assert.throws(() => normalizeMemberSchedules(Array.from({ length: 21 }, (_, index) => schedule({ name: `成员 ${index}` }))), /最多 20/);
  assert.throws(() => normalizeMemberSchedules([{ ...schedule(), extra: true }]), /不支持的字段/);
});

test("advances each member's own recurrence across leap and month-end dates", () => {
  assert.equal(advanceMemberDueDate("2028-02-28", 1, "day"), "2028-02-29");
  assert.equal(advanceMemberDueDate("2028-02-28", 2, "week"), "2028-03-13");
  assert.equal(advanceMemberDueDate("2028-01-31", 1, "month"), "2028-02-29");
  assert.equal(advanceMemberDueDate("2028-02-29", 1, "month", 31), "2028-03-31");
  assert.equal(advanceMemberDueDate("2028-02-29", 1, "year"), "2029-02-28");
  assert.equal(advanceMemberDueDate("2031-02-28", 1, "year", 29), "2032-02-29");
  assert.equal(advanceMemberDueDate("2028-01-31", 2, "month"), "2028-03-31");
  assert.equal(memberIntervalLabel(2, "month"), "每 2 个月");
  assert.equal(memberIntervalLabel(1, "month"), "每月");
  assert.throws(() => advanceMemberDueDate("2028-02-30", 1, "month"), /日期.*格式/);
  assert.throws(() => advanceMemberDueDate("2028-02-29", 1, "month", 32), /锚定日期/);
  assert.throws(() => advanceMemberDueDate("9999-12-31", 1, "day"), /超出支持范围/);
});

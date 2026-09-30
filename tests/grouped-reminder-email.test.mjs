import assert from "node:assert/strict";
import test from "node:test";
import { composeGroupedReminderEmail } from "../lib/grouped-reminder-email.ts";

test("groups multiple member collections from one subscription into a single message", () => {
  const message = composeGroupedReminderEmail({
    serviceName: "OneDrive",
    dueDate: "2026-10-01",
    charges: [
      { kind: "member", memberName: "成员甲", amount: "TRY 48.50", cycle: "每 2 个月" },
      { kind: "member", memberName: "成员乙", amount: "BOB 75.00", cycle: "每 3 周" },
    ],
  });
  assert.match(message.subject, /OneDrive 明天有 2 笔款项待处理/);
  assert.match(message.text, /向成员甲收款：TRY 48\.50，每 2 个月/);
  assert.match(message.text, /向成员乙收款：BOB 75\.00，每 3 周/);
  assert.match(message.html, /成员甲/);
  assert.match(message.html, /成员乙/);
  assert.match(message.html, /成员应收/);
  assert.doesNotMatch(message.html, /订阅支出/);
  assert.match(message.html, /2026-10-01/);
  assert.doesNotMatch(message.html, /<a\b|href=|https?:\/\//i);
});

test("includes the parent renewal in the same message and escapes user-entered labels", () => {
  const message = composeGroupedReminderEmail({
    serviceName: "A&B <Cloud>\nservice",
    dueDate: "2026-10-01",
    charges: [
      { kind: "subscription", amount: "CNY 100.00", cycle: "每月" },
      { kind: "member", memberName: "<script>\"A\"", amount: "CNY 25.00", cycle: "每周" },
    ],
  });
  assert.equal(message.subject, "A&B <Cloud> service 明天有 2 笔款项待处理");
  assert.match(message.text, /主订阅续费：CNY 100\.00，每月/);
  assert.match(message.text, /订阅支出：[\s\S]*成员应收：/);
  assert.match(message.html, /订阅支出[\s\S]*成员应收/);
  assert.match(message.html, /A&amp;B &lt;Cloud&gt; service/);
  assert.match(message.html, /&lt;script&gt;&quot;A&quot;/);
  assert.doesNotMatch(message.html, /<script>/);
  assert.throws(() => composeGroupedReminderEmail({ serviceName: "OneDrive", dueDate: "2026-10-01", charges: [] }), /至少/);
});

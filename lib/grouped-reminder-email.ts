export type ReminderCharge =
  | { kind: "subscription"; amount: string; cycle: string }
  | { kind: "member"; memberName: string; amount: string; cycle: string };

export type GroupedReminderContent = {
  serviceName: string;
  dueDate: string;
  charges: readonly ReminderCharge[];
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

export function composeGroupedReminderEmail(message: GroupedReminderContent) {
  if (!message.charges.length) throw new Error("到期提醒至少需要一笔费用");

  const serviceName = message.serviceName.replace(/[\r\n]+/g, " ").trim();
  const subject = `${serviceName} 明天有 ${message.charges.length} 笔款项待处理`;
  const rows = message.charges.map((charge) => ({
    kind: charge.kind,
    label: charge.kind === "subscription" ? "主订阅续费" : `向${charge.memberName}收款`,
    amount: charge.amount,
    cycle: charge.cycle,
  }));
  const expenseRows = rows.filter((row) => row.kind === "subscription");
  const receivableRows = rows.filter((row) => row.kind === "member");
  const text = [
    `明天（${message.dueDate}），${serviceName} 有 ${rows.length} 笔款项待处理：`,
    ...(expenseRows.length ? ["", "订阅支出：", ...expenseRows.map((row) => `${row.label}：${row.amount}，${row.cycle}`)] : []),
    ...(receivableRows.length ? ["", "成员应收：", ...receivableRows.map((row) => `${row.label}：${row.amount}，${row.cycle}`)] : []),
    "",
    "完成续费或收款后，请在 TuD 中标记。",
  ].join("\n");
  const section = (heading: string, items: typeof rows) => {
    if (!items.length) return "";
    const tableRows = items.map((row) => `<tr>
              <td style="padding:12px 10px;border-top:1px solid #e1e6ee;color:#26344b">${escapeHtml(row.label)}</td>
              <td style="padding:12px 10px;border-top:1px solid #e1e6ee;color:#17243a;font-weight:700;white-space:nowrap">${escapeHtml(row.amount)}</td>
              <td style="padding:12px 10px;border-top:1px solid #e1e6ee;color:#566277;white-space:nowrap">${escapeHtml(row.cycle)}</td>
            </tr>`).join("\n");
    return `<h2 style="margin:24px 0 8px;color:#26344b;font-size:15px">${heading}</h2>
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-size:13px">
        <thead><tr><th align="left" style="padding:9px 10px;color:#728098;font-weight:600">项目</th><th align="left" style="padding:9px 10px;color:#728098;font-weight:600">金额</th><th align="left" style="padding:9px 10px;color:#728098;font-weight:600">周期</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>`;
  };
  const html = `<!doctype html>
<html lang="zh-CN"><body style="margin:0;background:#f5f7fb;color:#182235;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:40px 16px">
    <div style="padding:28px;border:1px solid #dce3ec;border-radius:14px;background:#fffefb">
      <div style="font-size:15px;font-weight:750">TuD</div>
      <h1 style="margin:28px 0 8px;font-size:22px;line-height:1.3">明天有 ${rows.length} 笔款项待处理</h1>
      <p style="margin:0 0 22px;color:#6f7a8b;font-size:14px;line-height:1.6"><strong style="color:#17243a">${escapeHtml(serviceName)}</strong> · ${escapeHtml(message.dueDate)}</p>
      ${section("订阅支出", expenseRows)}
      ${section("成员应收", receivableRows)}
      <p style="margin:24px 0 0;color:#8b95a4;font-size:12px;line-height:1.6">这是你在 TuD 中开启的到期前 1 天提醒。完成续费或收款后，请在订阅详情中标记。</p>
    </div>
  </div>
</body></html>`;

  return { subject, text, html };
}

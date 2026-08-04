const secret = process.env.REMINDER_CRON_SECRET?.trim();
if (!secret) throw new Error("REMINDER_CRON_SECRET 未配置");

const response = await fetch("http://127.0.0.1:3000/api/cron/subscription-reminders", {
  method: "POST",
  headers: { authorization: `Bearer ${secret}` },
});
const body = await response.text();
if (!response.ok) throw new Error(`订阅提醒任务失败（${response.status}）：${body}`);
console.info(body);

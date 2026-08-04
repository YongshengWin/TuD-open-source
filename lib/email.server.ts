import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { releaseAuthEmail, reserveAuthEmail } from "./email-quota.server";

export type AuthOtpPurpose = "sign-in" | "email-verification" | "forget-password" | "change-email";

type AuthOtpMessage = {
  email: string;
  otp: string;
  type: AuthOtpPurpose;
};

export type SubscriptionReminderMessage = {
  email: string;
  serviceName: string;
  amount: string;
  dueDate: string;
  billingCycle: string;
};

let transporter: Transporter | null = null;

function configuredTransporter() {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASSWORD;
  if (!host) throw new Error("SMTP_HOST 未配置，无法发送邮箱验证码");
  if ((user && !pass) || (!user && pass)) throw new Error("SMTP_USER 与 SMTP_PASSWORD 必须同时配置");

  const port = Number(process.env.SMTP_PORT ?? "587");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("SMTP_PORT 配置不正确");
  const secure = process.env.SMTP_SECURE == null
    ? port === 465
    : process.env.SMTP_SECURE === "true";
  const requireTLS = process.env.SMTP_REQUIRE_TLS == null
    ? process.env.NODE_ENV === "production" && !secure
    : process.env.SMTP_REQUIRE_TLS === "true";

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS,
    ...(user && pass ? { auth: { user, pass } } : {}),
  });
  return transporter;
}

function purposeCopy(type: AuthOtpPurpose) {
  if (type === "change-email") return { subject: "确认你的 TuD 新邮箱", intro: "你正在为 TuD 账户更换邮箱。" };
  if (type === "forget-password") return { subject: "重置你的 TuD 密码", intro: "你正在重置 TuD 账户密码。" };
  if (type === "sign-in") return { subject: "登录 TuD", intro: "你正在登录 TuD。" };
  return { subject: "验证你的 TuD 邮箱", intro: "完成邮箱验证，即可开始管理订阅。" };
}

function maskedEmail(email: string) {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1) || "*"}***@${domain || "unknown"}`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

export async function sendAuthOtp({ email, otp, type }: AuthOtpMessage) {
  const { subject, intro } = purposeCopy(type);
  const from = process.env.EMAIL_FROM?.trim() || process.env.SMTP_FROM?.trim();

  if (!process.env.SMTP_HOST && process.env.NODE_ENV !== "production") {
    // Local-only delivery sink. This keeps first-run development lightweight;
    // production never prints authentication codes.
    console.info(`[TuD development mail] ${subject} → ${maskedEmail(email)}: ${otp}`);
    return;
  }
  if (!from) throw new Error("EMAIL_FROM 未配置，无法发送邮箱验证码");

  const text = `${intro}\n\n验证码：${otp}\n\n验证码 10 分钟内有效。若不是你本人操作，请忽略此邮件。`;
  const html = `<!doctype html>
<html lang="zh-CN"><body style="margin:0;background:#f3f5f8;color:#182235;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:520px;margin:0 auto;padding:40px 20px">
    <div style="padding:30px;border:1px solid #e1e6ee;border-radius:18px;background:#ffffff">
      <div style="font-size:18px;font-weight:750;letter-spacing:-.03em">TuD</div>
      <h1 style="margin:28px 0 10px;font-size:24px;line-height:1.25">${subject}</h1>
      <p style="margin:0;color:#6f7a8b;font-size:14px;line-height:1.65">${intro}</p>
      <div style="margin:26px 0;padding:18px 20px;border-radius:13px;background:#f1f6ff;color:#17243b;font-size:30px;font-weight:760;letter-spacing:.22em;text-align:center">${otp}</div>
      <p style="margin:0;color:#8b95a4;font-size:12px;line-height:1.65">验证码 10 分钟内有效，并且只能使用一次。若不是你本人操作，请忽略此邮件。</p>
    </div>
  </div>
</body></html>`;

  const reservation = await reserveAuthEmail(email);
  try {
    await configuredTransporter().sendMail({ from, to: email, subject, text, html });
  } catch (error) {
    try {
      await releaseAuthEmail(reservation);
    } catch (releaseError) {
      console.error("Failed to release an email quota reservation", releaseError);
    }
    throw error;
  }
}

export async function sendSubscriptionReminderEmail(message: SubscriptionReminderMessage) {
  const from = process.env.EMAIL_FROM?.trim() || process.env.SMTP_FROM?.trim();
  const subject = `${message.serviceName} 将于明天续费`;

  if (!process.env.SMTP_HOST && process.env.NODE_ENV !== "production") {
    console.info(`[TuD development mail] ${subject} → ${maskedEmail(message.email)}`);
    return;
  }
  if (!from) throw new Error("EMAIL_FROM 未配置，无法发送订阅提醒");

  const appUrl = process.env.TUD_PUBLIC_URL?.trim()
    || process.env.BETTER_AUTH_URL?.trim()
    || "http://localhost:3000";
  const safeName = escapeHtml(message.serviceName);
  const safeAmount = escapeHtml(message.amount);
  const safeDate = escapeHtml(message.dueDate);
  const safeCycle = escapeHtml(message.billingCycle);
  const text = `${message.serviceName} 将于明天续费\n\n金额：${message.amount}\n续费日期：${message.dueDate}\n周期：${message.billingCycle}\n\n打开 TuD：${appUrl}`;
  const html = `<!doctype html>
<html lang="zh-CN"><body style="margin:0;padding:0;background:#f5f7fb;color:#182235;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#f5f7fb">
    <tr><td align="center" style="padding:40px 12px">
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width:520px;overflow:hidden;border:1px solid #dce3ec;border-radius:12px;background:#fffefb">
        <tr><td style="height:6px;background:#17243a;font-size:1px;line-height:1px">&nbsp;</td></tr>
        <tr><td style="padding:24px 32px">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"><tr>
            <td style="color:#17243a;font-size:15px;font-weight:750;letter-spacing:-.02em">TuD</td>
            <td align="right" style="color:#8b95a4;font-size:12px">到期提醒</td>
          </tr></table>
          <h1 style="margin:28px 0 8px;color:#17243a;font-size:22px;line-height:1.3">明天有一笔订阅续费</h1>
          <p style="margin:0 0 24px;color:#6f7a8b;font-size:14px;line-height:1.65"><strong style="color:#17243a">${safeName}</strong> 将在明天到期，请确认是否需要续费。</p>
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"><tr>
            <td width="12" height="20" style="border:1px solid #dce3ec;border-left:0;border-radius:0 10px 10px 0;background:#f5f7fb;font-size:1px">&nbsp;</td>
            <td style="border-bottom:1px dashed #dce3ec;font-size:1px">&nbsp;</td>
            <td width="12" height="20" style="border:1px solid #dce3ec;border-right:0;border-radius:10px 0 0 10px;background:#f5f7fb;font-size:1px">&nbsp;</td>
          </tr></table>
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-top:20px;border:1px solid #d9e3f1;border-radius:9px;background:#f1f6ff">
            <tr><td style="padding:20px 22px">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr><td style="padding-bottom:5px;color:#728098;font-size:11px">预计费用</td><td style="padding:0 0 5px 22px;color:#728098;font-size:11px">续费日期</td></tr>
                <tr><td style="color:#17243a;font-size:28px;font-weight:760;letter-spacing:-.03em">${safeAmount}</td><td style="padding-left:22px;border-left:1px solid #d9e3f1;color:#17243a;font-size:14px;font-weight:650">${safeDate}</td></tr>
                <tr><td colspan="2" style="height:16px;font-size:1px">&nbsp;</td></tr>
                <tr><td colspan="2" style="color:#566277;font-size:12px">计费周期：<strong style="color:#26344b">${safeCycle}</strong></td></tr>
              </table>
            </td></tr>
          </table>
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-top:28px"><tr><td align="center">
            <a href="${escapeHtml(appUrl)}" style="display:inline-block;padding:13px 46px;border-radius:8px;background:#17243a;color:#fff;font-size:13px;font-weight:700;text-decoration:none">查看订阅</a>
          </td></tr></table>
          <p style="margin:22px 0 0;color:#8b95a4;font-size:12px;line-height:1.65;text-align:center">这是你在 TuD 中开启的到期前 1 天提醒。若已完成续费，可在订阅详情中标记已续费。</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const reservation = await reserveAuthEmail(message.email);
  try {
    await configuredTransporter().sendMail({ from, to: message.email, subject, text, html });
  } catch (error) {
    try {
      await releaseAuthEmail(reservation);
    } catch (releaseError) {
      console.error("Failed to release a subscription reminder quota reservation", releaseError);
    }
    throw error;
  }
}

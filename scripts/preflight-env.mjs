import { pathToFileURL } from "node:url";

const placeholderPattern = /(?:change-me|example\.com|replace-with|password|secret)/i;

function required(env, name, errors) {
  const value = env[name]?.trim();
  if (!value) errors.push(`${name} 未配置`);
  return value ?? "";
}

function booleanValue(env, name, errors) {
  const value = env[name]?.trim();
  if (value && value !== "true" && value !== "false") errors.push(`${name} 必须是 true 或 false`);
}

export function productionEnvironmentErrors(env = process.env) {
  const errors = [];
  const databaseUrl = required(env, "DATABASE_URL", errors);
  const authUrl = required(env, "BETTER_AUTH_URL", errors);
  const authSecret = required(env, "BETTER_AUTH_SECRET", errors);
  const reminderCronSecret = required(env, "REMINDER_CRON_SECRET", errors);
  const smtpHost = required(env, "SMTP_HOST", errors);
  const emailFrom = required(env, "EMAIL_FROM", errors);

  if (databaseUrl) {
    try {
      const parsed = new URL(databaseUrl);
      if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") throw new Error();
      if (!parsed.hostname || !parsed.pathname.slice(1)) throw new Error();
    } catch {
      errors.push("DATABASE_URL 必须是有效的 PostgreSQL 连接地址");
    }
  }

  if (authUrl) {
    try {
      const parsed = new URL(authUrl);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/") throw new Error();
    } catch {
      errors.push("BETTER_AUTH_URL 必须是正式 HTTPS 根域名，例如 https://tud.example.com");
    }
  }

  if (authSecret && (authSecret.length < 32 || placeholderPattern.test(authSecret))) {
    errors.push("BETTER_AUTH_SECRET 必须是至少 32 字符的随机密钥，不能使用示例值");
  }
  if (reminderCronSecret && (reminderCronSecret.length < 32 || placeholderPattern.test(reminderCronSecret))) {
    errors.push("REMINDER_CRON_SECRET 必须是至少 32 字符的随机密钥，不能使用示例值");
  }

  if (smtpHost && placeholderPattern.test(smtpHost)) errors.push("SMTP_HOST 仍是示例值");
  if (emailFrom && (!emailFrom.includes("@") || placeholderPattern.test(emailFrom))) errors.push("EMAIL_FROM 必须是真实发信地址");

  const smtpPort = Number(env.SMTP_PORT ?? "587");
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65_535) errors.push("SMTP_PORT 配置不正确");
  booleanValue(env, "SMTP_SECURE", errors);
  booleanValue(env, "SMTP_REQUIRE_TLS", errors);

  const smtpUser = env.SMTP_USER?.trim();
  const smtpPassword = env.SMTP_PASSWORD;
  if ((smtpUser && !smtpPassword) || (!smtpUser && smtpPassword)) {
    errors.push("SMTP_USER 与 SMTP_PASSWORD 必须同时配置");
  }
  if (smtpPassword && placeholderPattern.test(smtpPassword)) errors.push("SMTP_PASSWORD 仍是示例值");

  for (const [name, fallback] of [["EMAIL_DAILY_LIMIT", "100"], ["EMAIL_RECIPIENT_DAILY_LIMIT", "3"]]) {
    const value = Number(env[name] ?? fallback);
    if (!Number.isInteger(value) || value < 1) errors.push(`${name} 必须是正整数`);
  }
  for (const name of ["EMAIL_QUOTA_WHITELIST", "SUBSCRIPTION_REMINDER_EMAILS"]) {
    const emails = (env[name] ?? "").split(",").map((email) => email.trim()).filter(Boolean);
    if (emails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      errors.push(`${name} 必须是以逗号分隔的邮箱地址`);
    }
  }

  return errors;
}

export function assertProductionEnvironment(env = process.env) {
  if (env.NODE_ENV !== "production") return;
  const errors = productionEnvironmentErrors(env);
  if (!errors.length) return;
  throw new Error(`生产环境配置不完整：\n- ${errors.join("\n- ")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assertProductionEnvironment();
    console.info("TuD production environment check passed.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

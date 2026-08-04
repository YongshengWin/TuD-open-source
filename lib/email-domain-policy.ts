export const REGISTRATION_EMAIL_DOMAIN_ERROR = "请选择支持的主流公共邮箱后缀";
export const REGISTRATION_EMAIL_LOCAL_ERROR = "请输入正确的邮箱账号，无需填写 @ 后缀";

export const REGISTRATION_EMAIL_OPTIONS = [
  ["gmail.com", "Gmail"],
  ["outlook.com", "Outlook"],
  ["hotmail.com", "Hotmail"],
  ["live.com", "Live"],
  ["icloud.com", "iCloud"],
  ["yahoo.com", "Yahoo"],
  ["proton.me", "Proton Mail"],
  ["qq.com", "QQ 邮箱"],
  ["foxmail.com", "Foxmail"],
  ["163.com", "网易 163"],
  ["126.com", "网易 126"],
  ["yeah.net", "网易 Yeah"],
  ["sina.com", "新浪邮箱"],
  ["sohu.com", "搜狐邮箱"],
  ["aliyun.com", "阿里邮箱"],
  ["139.com", "139 邮箱"],
  ["189.cn", "189 邮箱"],
] as const;

const REGISTRATION_EMAIL_DOMAINS = new Set<string>(REGISTRATION_EMAIL_OPTIONS.map(([domain]) => domain));

export function composeRegistrationEmail(localPart: string, domain: string) {
  const normalizedLocalPart = localPart.trim();
  if (!normalizedLocalPart || normalizedLocalPart.includes("@") || !REGISTRATION_EMAIL_DOMAINS.has(domain)) return null;
  return `${normalizedLocalPart}@${domain}`.toLowerCase();
}

export function isAllowedRegistrationEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  const separator = normalized.lastIndexOf("@");
  if (separator <= 0 || separator === normalized.length - 1) return false;
  return REGISTRATION_EMAIL_DOMAINS.has(normalized.slice(separator + 1));
}

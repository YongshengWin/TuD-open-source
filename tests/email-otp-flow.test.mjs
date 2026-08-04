import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("requires encrypted email verification for password registration", async () => {
  const [auth, client, mailer] = await Promise.all([
    source("../lib/auth.ts"),
    source("../lib/auth-client.ts"),
    source("../lib/email.server.ts"),
  ]);

  assert.match(auth, /requireEmailVerification:\s*true/);
  assert.match(auth, /revokeSessionsOnPasswordReset:\s*true/);
  assert.match(auth, /autoSignInAfterVerification:\s*true/);
  assert.match(auth, /emailOTP\(/);
  assert.match(auth, /storeOTP:\s*"encrypted"/);
  assert.match(auth, /allowedAttempts:\s*3/);
  assert.match(auth, /rateLimit:\s*\{\s*window:\s*60,\s*max:\s*3\s*\}/);
  assert.match(auth, /changeEmail:\s*\{\s*enabled:\s*true,\s*verifyCurrentEmail:\s*true\s*\}/);
  assert.ok(auth.lastIndexOf("nextCookies()") > auth.lastIndexOf("emailOTP("), "nextCookies must remain the final plugin");
  assert.match(client, /emailOTPClient\(\)/);
  assert.match(mailer, /nodemailer\.createTransport/);
  assert.match(mailer, /requireTLS/);
  assert.match(mailer, /process\.env\.NODE_ENV === "production" && !secure/);
  assert.match(mailer, /process\.env\.NODE_ENV !== "production"/);
  assert.match(mailer, /production never prints authentication codes/);
});

test("renders registration verification, password recovery, and the two-address email change flow", async () => {
  const [login, security, profileRoute] = await Promise.all([
    source("../app/login/page.tsx"),
    source("../app/settings/security/security-panel.tsx"),
    source("../app/api/profile/route.ts"),
  ]);

  assert.match(login, /emailOtp\.verifyEmail/);
  assert.match(login, /emailOtp\.sendVerificationOtp/);
  assert.match(login, /emailOtp\.requestPasswordReset/);
  assert.match(login, /emailOtp\.resetPassword/);
  assert.match(login, /忘记密码/);
  assert.match(login, /REGISTRATION_EMAIL_OPTIONS\.map/);
  assert.match(login, /name="emailDomain"/);
  assert.match(login, /EMAIL_NOT_VERIFIED/);
  assert.match(login, /autoComplete="one-time-code"/);
  assert.match(security, /sendVerificationOtp\(\{ email: currentEmail/);
  assert.match(security, /emailOtp\.requestEmailChange\(\{ newEmail, otp: currentCode \}\)/);
  assert.match(security, /emailOtp\.changeEmail\(\{ newEmail, otp: newCode \}\)/);
  assert.match(security, /确认当前邮箱/);
  assert.match(security, /确认新邮箱/);
  assert.match(security, /authClient\.changePassword\(\{ currentPassword, newPassword, revokeOtherSessions: true \}\)/);
  assert.match(security, /修改密码/);
  assert.match(security, /删除密码登录/);
  assert.match(security, /authenticatorAttachment: "platform"/);
  assert.match(security, /等待系统验证/);
  assert.doesNotMatch(profileRoute, /email\s*:/, "the generic profile endpoint must not change login email");
});

test("removes password login only after password verification and with a remaining passkey", async () => {
  const route = await readFile(new URL("../app/api/security/password/route.ts", import.meta.url), "utf8");
  assert.match(route, /auth\.api\.getSession/);
  assert.match(route, /auth\.api\.verifyPassword/);
  assert.match(route, /eq\(passkey\.userId, currentSession\.user\.id\)/);
  assert.match(route, /eq\(account\.providerId, "credential"\)/);
  assert.match(route, /transaction\.delete\(account\)/);
});

test("enforces durable daily email quotas and closes email-dependent entry points", async () => {
  const [quota, mailer, auth, schema, migration, capacityRoute, login, compose] = await Promise.all([
    source("../lib/email-quota.server.ts"),
    source("../lib/email.server.ts"),
    source("../lib/auth.ts"),
    source("../db/schema.ts"),
    source("../migrations/0008_slow_darkhawk.sql"),
    source("../app/api/email-capacity/route.ts"),
    source("../app/login/page.tsx"),
    source("../compose.production.yaml"),
  ]);

  assert.match(quota, /DEFAULT_DAILY_LIMIT = 100/);
  assert.match(quota, /DEFAULT_RECIPIENT_LIMIT = 3/);
  assert.match(quota, /EMAIL_QUOTA_WHITELIST/);
  assert.doesNotMatch(quota, /DEFAULT_WHITELIST/);
  assert.match(quota, /pg_advisory_xact_lock/);
  assert.match(quota, /INSERT INTO email_delivery_daily/);
  assert.match(quota, /GREATEST\(delivery_count - 1, 0\)/);
  assert.match(mailer, /reserveAuthEmail/);
  assert.match(mailer, /releaseAuthEmail/);
  assert.match(auth, /"\/sign-up\/email"/);
  assert.match(auth, /EMAIL_DOMAIN_NOT_ALLOWED/);
  assert.match(auth, /"\/email-otp\/request-password-reset"/);
  assert.match(schema, /emailDeliveryDaily/);
  assert.match(migration, /CREATE TABLE "email_delivery_daily"/);
  assert.match(capacityRoute, /Cache-Control": "no-store"/);
  assert.match(capacityRoute, /PUBLIC_AUTH_ANNOUNCEMENT/);
  assert.match(login, /fetch\("\/api\/email-capacity"/);
  assert.match(login, /disabled=\{!emailIntakeAvailable\}/);
  assert.match(login, /auth-announcement/);
  assert.match(login, /今日邮件系统已经关闭，注册、密码找回功能不可用/);
  assert.doesNotMatch(login, /今日邮件额度已用尽/);
  assert.match(compose, /EMAIL_DAILY_LIMIT: \$\{EMAIL_DAILY_LIMIT:-100\}/);
});

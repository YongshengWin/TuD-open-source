import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { productionEnvironmentErrors } from "../scripts/preflight-env.mjs";

const validEnvironment = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://tud:0123456789abcdef@postgres:5432/tud",
  BETTER_AUTH_URL: "https://tud.example.test",
  BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
  REMINDER_CRON_SECRET: "abcdef0123456789abcdef0123456789",
  SMTP_HOST: "smtp.example.test",
  SMTP_PORT: "587",
  SMTP_SECURE: "false",
  SMTP_REQUIRE_TLS: "true",
  SMTP_USER: "mailer@example.test",
  SMTP_PASSWORD: "0123456789abcdef",
  EMAIL_FROM: "TuD <mailer@example.test>",
};

test("accepts a complete production environment", () => {
  assert.deepEqual(productionEnvironmentErrors(validEnvironment), []);
});

test("rejects unsafe production defaults", () => {
  const errors = productionEnvironmentErrors({
    ...validEnvironment,
    DATABASE_URL: "not-a-database",
    BETTER_AUTH_URL: "http://localhost:3000",
    BETTER_AUTH_SECRET: "replace-with-secret",
    SMTP_HOST: "smtp.example.com",
    SMTP_PASSWORD: "replace-with-password",
    EMAIL_FROM: "TuD <no-reply@example.com>",
  });
  assert.ok(errors.length >= 6);
});

test("ships a health-checked reverse-proxy-ready compose stack and update path", async () => {
  const [compose, dockerfile, nextConfig, deploy, update, rollback, reminderCron] = await Promise.all([
    readFile(new URL("../compose.production.yaml", import.meta.url), "utf8"),
    readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
    readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/deploy-production.sh", import.meta.url), "utf8"),
    readFile(new URL("../scripts/update-production.sh", import.meta.url), "utf8"),
    readFile(new URL("../scripts/rollback-production.sh", import.meta.url), "utf8"),
    readFile(new URL("../deploy/tud-reminders.cron", import.meta.url), "utf8"),
  ]);

  assert.match(compose, /127\.0\.0\.1:\$\{APP_PORT:-3000\}:3000/);
  assert.doesNotMatch(compose, /80:80|443:443/);
  assert.match(compose, /POSTGRES_PASSWORD:\s*\$\{POSTGRES_PASSWORD:\?/);
  assert.match(compose, /REMINDER_CRON_SECRET:\s*\$\{REMINDER_CRON_SECRET:\?/);
  assert.match(compose, /api\/health/);
  assert.doesNotMatch(compose, /5432:5432/);
  assert.match(dockerfile, /USER nextjs/);
  assert.match(dockerfile, /\.next\/standalone/);
  assert.match(nextConfig, /output: "standalone"/);
  assert.match(deploy, /run --rm migrate/);
  assert.match(deploy, /api\/brands\/search/);
  assert.match(deploy, /restore_previous_app/);
  assert.match(update, /git pull --ff-only/);
  assert.match(update, /--untracked-files=normal/);
  assert.match(rollback, /--no-deps app/);
  assert.match(reminderCron, /send-subscription-reminders\.mjs/);
});

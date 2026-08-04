import assert from "node:assert/strict";
import test from "node:test";
import { forbiddenPathReason, scanText } from "../scripts/privacy-check.mjs";

test("blocks private deployment files and credential artifacts", () => {
  assert.ok(forbiddenPathReason(".env.production"));
  assert.ok(forbiddenPathReason("backups/tud.dump"));
  assert.ok(forbiddenPathReason("server/id_ed25519"));
  assert.equal(forbiddenPathReason(".env.production.example"), null);
  assert.equal(forbiddenPathReason("migrations/0012_example.sql"), null);
});

test("detects high-confidence secrets without echoing their values", () => {
  assert.deepEqual(scanText(`-----BEGIN ${"PRIVATE"} KEY-----\nprivate`, "notes.txt"), ["私钥"]);
  assert.ok(scanText(`${"SMTP_PASSWORD"}=a-real-production-value`, "config.txt").some((item) => item.includes("SMTP_PASSWORD")));
  const credentialUrl = ["postgresql", "://", "owner:real-password", "@database.internal/tud"].join("");
  assert.ok(scanText(credentialUrl, "config.txt").includes("含明文密码的数据库连接串"));
});

test("detects personal identifiers but permits explicit examples", () => {
  assert.ok(scanText(`contact me@${"personal-domain.invalid"}`, "README.md").includes("非示例邮箱地址"));
  assert.ok(scanText(`open /${"Users"}/private-name/project`, "README.md").includes("本机用户目录绝对路径"));
  assert.deepEqual(scanText("admin@example.com", "README.md"), []);
});

test("permits environment references and documented placeholders", () => {
  const example = [
    "SMTP_PASSWORD=replace-with-password",
    "BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}",
    "DATABASE_URL=postgresql://tud:password@localhost:5432/tud",
    "const secret = process.env.BETTER_AUTH_SECRET;",
  ].join("\n");
  assert.deepEqual(scanText(example, ".env.production.example"), []);
});

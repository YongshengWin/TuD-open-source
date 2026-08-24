import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { commitsFromPrePush, forbiddenPathReason, runPrivacyCheck, scanText } from "../scripts/privacy-check.mjs";

const ZERO_SHA = "0".repeat(40);

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

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

test("new branch checks only omit commits already present on the target remote", () => {
  const root = mkdtempSync(join(tmpdir(), "tud-privacy-check-"));

  try {
    git(root, ["init", "--quiet", "--initial-branch=main"]);
    git(root, ["config", "user.name", "Privacy Check Test"]);
    git(root, ["config", "user.email", ["legacy", "private.invalid"].join("@")]);
    git(root, ["remote", "add", "origin", "https://example.com/origin.git"]);
    git(root, ["remote", "add", "backup", "https://example.com/backup.git"]);

    const fixture = join(root, "fixture.txt");
    writeFileSync(fixture, "already published\n");
    git(root, ["add", "fixture.txt"]);
    git(root, ["commit", "--quiet", "-m", "Existing remote commit"]);
    const remoteCommit = git(root, ["rev-parse", "HEAD"]);
    git(root, ["update-ref", "refs/remotes/origin/main", remoteCommit]);

    git(root, ["config", "user.email", ["privacy-check", "users.noreply.github.com"].join("@")]);
    appendFileSync(fixture, "published only to backup\n");
    git(root, ["add", "fixture.txt"]);
    git(root, ["commit", "--quiet", "-m", "Backup-only commit"]);
    const backupCommit = git(root, ["rev-parse", "HEAD"]);
    git(root, ["update-ref", "refs/remotes/backup/main", backupCommit]);

    appendFileSync(fixture, "new branch change\n");
    git(root, ["add", "fixture.txt"]);
    git(root, ["commit", "--quiet", "-m", "New branch commit"]);
    const localCommit = git(root, ["rev-parse", "HEAD"]);
    const prePushInput = `refs/heads/topic ${localCommit} refs/heads/topic ${ZERO_SHA}\n`;
    const existingBranchInput = `refs/heads/topic ${localCommit} refs/heads/topic ${remoteCommit}\n`;
    const deleteInput = `refs/heads/topic ${ZERO_SHA} refs/heads/topic ${remoteCommit}\n`;

    assert.deepEqual([...commitsFromPrePush(root, prePushInput, "origin")], [localCommit, backupCommit]);
    assert.deepEqual([...commitsFromPrePush(root, prePushInput, "backup")], [localCommit]);
    assert.deepEqual([...commitsFromPrePush(root, prePushInput, "https://example.com/direct.git")], [
      localCommit,
      backupCommit,
      remoteCommit,
    ]);
    assert.deepEqual([...commitsFromPrePush(root, existingBranchInput)], [localCommit, backupCommit]);
    assert.deepEqual([...commitsFromPrePush(root, deleteInput, "origin")], []);
    assert.equal(runPrivacyCheck({ root, prePushInput, prePushRemote: "origin" }), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

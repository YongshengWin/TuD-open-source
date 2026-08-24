import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ZERO_SHA = /^0+$/;
const MAX_TEXT_BYTES = 8 * 1024 * 1024;
const PLACEHOLDER_VALUE = /(?:example(?:\.com|\.test)?|replace[-_ ]?with|change[-_ ]?me|placeholder|localhost|127\.0\.0\.1|\$\{|process\.env|0123456789abcdef|abcdef0123456789|not-a-|build-only)/i;

const HIGH_CONFIDENCE_PATTERNS = [
  ["私钥", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ["AWS Access Key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["GitHub Token", /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/],
  ["OpenAI 风格密钥", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
  ["Slack Token", /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ["Stripe Live Key", /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/],
];

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: options.cwd,
    encoding: options.encoding ?? "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: options.stdio,
  });
}

function splitNull(value) {
  return value.split("\0").filter(Boolean);
}

function isProbablyBinary(buffer) {
  return buffer.subarray(0, Math.min(buffer.length, 8_192)).includes(0);
}

function safePlaceholder(value) {
  return !value.trim() || PLACEHOLDER_VALUE.test(value);
}

export function forbiddenPathReason(path) {
  const normalized = path.replaceAll("\\", "/");
  const basename = normalized.split("/").at(-1) ?? normalized;

  if (/^\.env(?:\..+)?$/i.test(basename) && basename !== ".env.example" && basename !== ".env.production.example") {
    return "真实环境文件不能进入 Git";
  }
  if (/(^|\/)(?:backups?|dumps?)(\/|$)/i.test(normalized)) return "备份或转储目录不能进入 Git";
  if (/\.(?:pem|key|p12|pfx|jks|keystore|dump|bak|sqlite|sqlite3|db|log)$/i.test(basename)) {
    return "疑似密钥、数据库、备份或日志文件";
  }
  if (/^(?:id_rsa|id_ed25519|authorized_keys|known_hosts|apikey\.txt|\.bash_history|\.zsh_history)$/i.test(basename)) {
    return "本机凭据或 Shell 历史不能进入 Git";
  }
  return null;
}

export function scanText(text, path = "") {
  const findings = [];
  for (const [label, pattern] of HIGH_CONFIDENCE_PATTERNS) {
    if (pattern.test(text)) findings.push(label);
  }

  if (/\/(?:Users|home)\/[^/\s"']+/i.test(text)) findings.push("本机用户目录绝对路径");

  const emailPattern = /\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi;
  for (const match of text.matchAll(emailPattern)) {
    const domain = (match[1] ?? "").toLowerCase();
    const allowedTestFixture = path === "tests/email-domain-policy.test.mjs";
    if (!allowedTestFixture && domain !== "example.com" && domain !== "example.test" && !domain.endsWith(".example")) {
      findings.push("非示例邮箱地址");
      break;
    }
  }

  const credentialUrlPattern = /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:/]+:([^\s@]+)@([^\s/:]+)/gi;
  for (const match of text.matchAll(credentialUrlPattern)) {
    const password = match[1] ?? "";
    const host = match[2] ?? "";
    if (!safePlaceholder(password) && !PLACEHOLDER_VALUE.test(host)) {
      findings.push("含明文密码的数据库连接串");
      break;
    }
  }

  const envSecretPattern = /^([A-Z][A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|API_KEY|PRIVATE_KEY)[A-Z0-9_]*)\s*=\s*(.*)$/gmi;
  for (const match of text.matchAll(envSecretPattern)) {
    const value = (match[2] ?? "").trim().replace(/^['"]|['"]$/g, "");
    if (!safePlaceholder(value)) {
      findings.push(`疑似明文配置 ${match[1]}`);
      break;
    }
  }

  return [...new Set(findings)];
}

function scanBuffer(path, buffer, findings, source = "工作区") {
  const pathReason = forbiddenPathReason(path);
  if (pathReason) findings.push({ source, path, reason: pathReason });
  if (buffer.length > MAX_TEXT_BYTES || isProbablyBinary(buffer)) return;
  for (const reason of scanText(buffer.toString("utf8"), path)) {
    findings.push({ source, path, reason });
  }
}

function scanCurrentTree(root, findings) {
  const files = splitNull(git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root }));
  for (const path of files) {
    try {
      scanBuffer(path, readFileSync(resolve(root, path)), findings);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

export function commitsFromPrePush(root, input, remoteName = null) {
  const commits = new Set();
  const configuredRemotes = new Set(git(["remote"], { cwd: root }).trim().split("\n").filter(Boolean));
  const targetRemoteIsConfigured = remoteName && configuredRemotes.has(remoteName);

  for (const line of input.trim().split("\n").filter(Boolean)) {
    const [, localSha, , remoteSha] = line.trim().split(/\s+/);
    if (!localSha || ZERO_SHA.test(localSha)) continue;
    const remoteBranchExists = remoteSha && !ZERO_SHA.test(remoteSha);
    const excludedRevisions = [
      ...(remoteBranchExists ? [remoteSha] : []),
      ...(targetRemoteIsConfigured ? [`--remotes=${remoteName}`] : []),
    ];
    const args = ["rev-list", localSha, ...(excludedRevisions.length ? ["--not", ...excludedRevisions] : [])];
    for (const commit of git(args, { cwd: root }).trim().split("\n").filter(Boolean)) commits.add(commit);
  }
  return commits;
}

function scanCommits(root, commits, findings) {
  for (const commit of commits) {
    const short = commit.slice(0, 12);
    const authorEmail = git(["log", "-1", "--format=%ae", commit], { cwd: root }).trim();
    if (authorEmail && !/noreply/i.test(authorEmail) && !/@example(?:\.com|\.test)$/i.test(authorEmail)) {
      findings.push({ source: `提交 ${short}`, path: "作者邮箱", reason: "提交作者邮箱不是 noreply 隐私地址" });
    }
    const message = git(["log", "-1", "--format=%B", commit], { cwd: root });
    for (const reason of scanText(message, "COMMIT_MESSAGE")) {
      findings.push({ source: `提交 ${short}`, path: "提交说明", reason });
    }

    const paths = splitNull(git(["diff-tree", "--root", "-m", "--no-commit-id", "--name-only", "-r", "-z", commit], { cwd: root }));
    for (const path of new Set(paths)) {
      const blob = spawnSync("git", ["cat-file", "blob", `${commit}:${path}`], {
        cwd: root,
        encoding: "buffer",
        maxBuffer: 64 * 1024 * 1024,
      });
      if (blob.status === 0 && Buffer.isBuffer(blob.stdout)) scanBuffer(path, blob.stdout, findings, `提交 ${short}`);
    }
  }
}

function report(findings) {
  if (!findings.length) {
    console.info("Privacy check passed: no tracked secrets or private artifacts detected.");
    return 0;
  }
  console.error("Privacy check failed. The following paths need review:");
  for (const finding of findings) console.error(`- ${finding.source}: ${finding.path} (${finding.reason})`);
  console.error("The suspected value is intentionally not printed. Remove it from Git and rotate it if it was real.");
  return 1;
}

export function runPrivacyCheck({
  root = git(["rev-parse", "--show-toplevel"]).trim(),
  prePushInput = null,
  prePushRemote = null,
} = {}) {
  const findings = [];
  if (prePushInput == null) scanCurrentTree(root, findings);
  else scanCommits(root, commitsFromPrePush(root, prePushInput, prePushRemote), findings);
  return report(findings);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const prePush = process.argv.includes("--pre-push");
  const remoteOptionIndex = process.argv.indexOf("--remote");
  const prePushRemote = remoteOptionIndex >= 0 ? process.argv[remoteOptionIndex + 1] || null : null;
  const input = prePush ? readFileSync(0, "utf8") : null;
  process.exitCode = runPrivacyCheck({ prePushInput: input, prePushRemote });
}

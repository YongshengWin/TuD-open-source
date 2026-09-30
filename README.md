# TuD

高性能、双端友好的自托管订阅管理网站。它使用自己的账号系统与 PostgreSQL，不依赖 ChatGPT 登录或 GPT 托管。

## 架构

- Next.js 16（Node.js 运行时）
- PostgreSQL + Drizzle ORM
- Better Auth 邮箱密码登录 + 6 位邮箱验证码
- WebAuthn Passkey（Touch ID、Face ID、Windows Hello、安全密钥）
- HttpOnly 会话 Cookie；订阅业务数据仅保存在服务端数据库
- PostgreSQL 统一图标索引：订阅只保存稳定的 `iconId`，不保存浏览器侧图标状态
- HD-Icons、Dashboard Icons、Lobe Icons、selfh.st、Simple Icons 与本地精选共 11,108 个可搜索图标
- 图标由服务端按需校验、缓存并通过同源地址返回；未知服务可从其官网发现并写入同一索引
- 官网没有可用图标时，可创建最多 4 个字符的字母图标，选择预设或自定义颜色，并以“文字 + 颜色”的唯一 ID 写入同一服务端索引
- 订阅卡片会根据图标生成轻量浅色水彩背景，也可为单项自定义色调
- 详情页的图标标题区与首页卡片使用同一色调，金额区保持中性易读
- 用户可修改昵称与头像；头像数据仍保存在 PostgreSQL
- 修改登录邮箱需要依次验证当前邮箱和新邮箱
- 网格、列表与日历三种视图；移动端日历自动切换为紧凑日程列表
- 每条订阅可为家庭成员单独设置收款金额、币种、下次收款日与自定义天／周／月／年周期；收款记录保存在服务端，不创建成员登录账号

## 成员收款

在订阅编辑页添加成员收款安排，成员可有不同的加入日期、收款金额、币种和周期。详情页可逐人“标记已收款”，系统记录实际收款时间和当期应收快照，再按该成员的周期推进下次日期；历史可在详情页继续翻阅。成员收款与订阅本身的费用、续费日期、支出汇总分开计算。每位成员可独立开启收款前一天的邮件提醒，发送到管理者账号邮箱；同一订阅同日应收合并为一封邮件。提醒资格沿用现有的邮件提醒账户配置。

此功能使用新增的 `member_schedules` 字段和 `subscription_member_payments` 表。迁移只添加字段和表；旧订阅的成员列表默认为空。永久删除订阅时，该订阅的成员收款历史也会一并删除，界面会在删除前提示。

## 本地启动

要求 Node.js `>=22.13.0`，并安装 Docker。

```bash
cp .env.example .env
# 将 BETTER_AUTH_SECRET 换成：openssl rand -base64 32
docker compose up -d
npm ci
npm run privacy:install-hook
npm run db:migrate
npm run dev
```

打开 `http://localhost:3000`，先注册邮箱密码账号，再从“账户与安全”添加 Passkey。

本地未配置 SMTP 时，开发服务器会把验证码写到终端，便于首次调试；生产环境不会输出验证码，必须配置 SMTP。

图标目录使用固定的上游版本，普通启动和构建不会联网更新。需要升级目录时显式执行：

```bash
npm run icons:sync
```

来源版本和许可信息见 `lib/icon-source-lock.json` 与 `THIRD_PARTY_NOTICES.md`。

`privacy:install-hook` 会启用仓库内的 `pre-push` 隐私检查。每次推送前会扫描待推送提交中的环境文件、备份、日志、私钥、常见 Token、真实邮箱和本机绝对路径；`npm run test:release` 也会执行同一检查。扫描命中时只报告文件和规则，不回显疑似秘密。

## 部署到自己的服务器

推荐使用仓库内的生产 Compose。它包含：

- TuD Node.js 应用
- PostgreSQL 17（仅容器内网可访问）
- 仅监听本机的应用端口，可接入现有 Nginx、Caddy 或其他 HTTPS 反向代理
- 数据库迁移、应用健康检查和自动重启
- 首次启动后的图标目录预热
- 按 Git revision 标记的本地应用镜像，便于快速回滚

服务器需要安装 Git、Docker Engine 和 Docker Compose v2。建议至少准备 1 GB 内存，并把域名的 A/AAAA 记录指向服务器。防火墙只需对外开放 SSH、80 和 443。

### 首次部署

```bash
git clone <your-repository-url> tud
cd tud
cp .env.production.example .env.production
chmod 600 .env.production
```

本机已有 Nginx 时，先把 `deploy/nginx.conf.example` 中的示例域名替换为自己的域名，
再安装到 `/etc/nginx/sites-available/tud` 并启用。TuD 仅绑定
`127.0.0.1:3000`，不会占用公网 80/443，也不会影响同机的其他域名。
配置通过 `nginx -t` 后，可使用 Certbot 签发证书：

```bash
certbot --nginx -d tud.example.com --email admin@example.com --agree-tos --no-eff-email --redirect
```

编辑 `.env.production`：

- `DOMAIN`：不带协议的域名，例如 `tud.example.com`
- `ACME_EMAIL`：证书到期通知邮箱
- `BETTER_AUTH_URL`：与域名一致的 HTTPS 地址
- `TUD_PUBLIC_URL`：可选；默认使用 `BETTER_AUTH_URL`，仅在需要对外展示不同地址时设置
- `POSTGRES_PASSWORD`：建议使用 `openssl rand -hex 32`
- `BETTER_AUTH_SECRET`：建议使用另一份 `openssl rand -hex 32`
- `REMINDER_CRON_SECRET`：再生成一份独立的 `openssl rand -hex 32`，只用于保护内部提醒任务
- `SUBSCRIPTION_REMINDER_EMAILS`：允许开启到期提醒的账号邮箱，多个邮箱用英文逗号分隔；未设置时沿用 `EMAIL_QUOTA_WHITELIST`，明确设为空时关闭提醒
- 完整 SMTP 配置和真实的 `EMAIL_FROM`

认证邮件默认按 UTC 自然日限制为全站 100 封、每个收件邮箱 3 封。`EMAIL_QUOTA_WHITELIST` 中的邮箱不受单邮箱限制，但仍计入全站额度。全站额度耗尽后，注册和新密码找回会自动关闭，登录与 Passkey 不受影响。可通过 `PUBLIC_AUTH_ANNOUNCEMENT` 在登录卡片发布最多 240 字的临时公告；留空时不显示。

正式发信域名应配置 SPF、DKIM 和 DMARC。Passkey 与域名绑定，因此上线后不要随意更换 `BETTER_AUTH_URL`。

先执行发布检查，再部署：

```bash
npm ci
npm run test:release
./scripts/deploy-production.sh
```

部署脚本会按以下顺序执行：构建新镜像、启动 PostgreSQL、执行向前迁移、替换应用容器、等待健康检查、预热图标目录。构建阶段旧容器保持在线，实际中断窗口只发生在应用容器替换期间；新容器健康检查失败时，脚本会自动恢复上一个成功镜像。

检查状态与日志：

```bash
docker compose --env-file .env.production -f compose.production.yaml ps
docker compose --env-file .env.production -f compose.production.yaml logs -f --tail=200 app postgres
curl --fail https://你的域名/api/health
```

### 后续快捷更新

服务器工作区必须保持干净。每次把已测试代码推送到部署分支后，在服务器运行：

```bash
./scripts/update-production.sh
```

该命令要求服务器工作区没有已修改、暂存或未跟踪的文件，只接受 fast-forward 更新，然后复用完整部署流程。每个应用镜像使用当前 Git revision 作为标签；上一个成功版本会记录在服务器本地。

如果新版本应用异常，可快速回滚应用镜像：

```bash
./scripts/rollback-production.sh
```

回滚只替换应用镜像，不会反向执行数据库迁移。因此迁移必须保持向后兼容：先添加字段/表，再发布读取新结构的代码；删除字段应放到后续独立版本。若迁移本身出现问题，应从备份恢复数据库，而不是依赖应用回滚。

### 数据库备份

手动创建 PostgreSQL 自定义格式备份：

```bash
./scripts/backup-postgres.sh
```

服务器使用 `/opt/tud` 作为部署目录时，可安装每日自动备份任务：

```bash
install -m 644 deploy/tud-backup.cron /etc/cron.d/tud-backup
```

任务每天 UTC 03:17 写入 `backups/`，日志位于 `/var/log/tud-backup.log`。

只有 `SUBSCRIPTION_REMINDER_EMAILS` 中配置的账号可以开启订阅续费或成员收款邮件提醒；未设置该变量时沿用 `EMAIL_QUOTA_WHITELIST`，明确设为空则关闭提醒。成员提醒在每位成员的收款安排中单独开启。安装每日提醒任务：

```bash
install -m 644 deploy/tud-reminders.cron /etc/cron.d/tud-reminders
```

任务每天北京时间 08:05 检查次日到期项目。同一订阅同日的续费和多位成员应收合成一封邮件，分别列出支出与应收。发送记录会在正常重复执行时防止重发；若邮件服务已接收邮件、而数据库未能记录发送成功，重试仍可能再发一次。日志位于 `/var/log/tud-reminders.log`。

备份默认写入服务器的 `backups/`，权限为 `600`。建议通过 cron 每天执行，并把备份同步到另一台机器或对象存储；仅保存在同一块服务器磁盘上不算有效灾备。恢复前先停应用并在独立环境验证备份文件。

### 不使用 Docker

也可以使用外部 PostgreSQL、systemd 和现有反向代理：

```bash
npm ci
npm run db:migrate:runtime
npm run build
NODE_ENV=production npm start
```

这种方式同样必须提供 `.env.example` 中列出的生产变量，并自行配置 HTTPS、进程重启、日志轮转、健康检查和备份。

当前项目不包含任何 GPT Sites/Cloudflare D1 配置，也不会自动部署。

## 参与贡献

提交改动前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [AGENTS.md](AGENTS.md)，并运行：

```bash
npm run test:release
```

安全漏洞请按 [SECURITY.md](SECURITY.md) 私下报告，不要在公开 Issue 中披露利用细节。

## 第三方资产与许可

项目源码采用 [MIT License](LICENSE)。图标目录包含多个独立维护的图标集合及品牌识别素材，具体来源、固定版本、许可和商标说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。MIT License 不会授予第三方商标或品牌素材的权利。

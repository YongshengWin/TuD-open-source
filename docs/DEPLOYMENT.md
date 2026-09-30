# TuD 服务器部署指南

这份指南配合项目首页的 [README](../README.md) 使用，适合已有域名和 Linux 服务器的自托管部署。命令默认在服务器上的仓库目录执行；安装 Nginx 配置和 cron 任务需要管理员权限。

## 1. 准备服务器

安装 Git、Docker Engine、Docker Compose v2、Node.js 22.13.0 或更高版本及 npm，建议至少准备 1 GB 内存。把域名的 A/AAAA 记录指向服务器，只对公网开放 SSH、80 和 443。TuD 的生产 Compose 会将应用绑定在 `127.0.0.1:3000`，PostgreSQL 只在容器网络中开放。

```bash
git clone https://github.com/YongshengWin/TuD-open-source.git tud
cd tud
cp .env.production.example .env.production
chmod 600 .env.production
```

## 2. 填写配置

编辑 `.env.production`。下面是首次上线必须核对的项目；示例文件还列出可选项。

| 变量 | 用途 |
| --- | --- |
| `BETTER_AUTH_URL` | 对外 HTTPS 地址，例如 `https://tud.example.com`；Passkey 与此域名绑定 |
| `POSTGRES_PASSWORD` | 生产数据库密码，建议使用 `openssl rand -hex 32` 生成 |
| `BETTER_AUTH_SECRET` | 认证密钥，单独生成，不与数据库密码共用 |
| `REMINDER_CRON_SECRET` | 保护内部提醒任务，再单独生成一份 |
| `SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、`SMTP_PASSWORD` | 发送注册、找回密码和提醒邮件的 SMTP 配置 |
| `EMAIL_FROM` | 经过发信服务验证的发件地址 |
| `SUBSCRIPTION_REMINDER_EMAILS` | 可以开启续费及成员收款提醒的账号邮箱，多个地址用英文逗号分隔 |

`TUD_PUBLIC_URL` 通常保持与 `BETTER_AUTH_URL` 相同，只有对外 API 地址确实不同才需要改。`DOMAIN`、`ACME_EMAIL` 是示例文件中的部署备忘字段，**不会自动配置 Nginx 或申请证书**。

提醒资格：未设置 `SUBSCRIPTION_REMINDER_EMAILS` 时，沿用 `EMAIL_QUOTA_WHITELIST`；明确设为空值时关闭提醒。认证邮件默认按 UTC 自然日限制为全站 100 封、每个收件邮箱 3 封，可通过 `EMAIL_DAILY_LIMIT` 与 `EMAIL_RECIPIENT_DAILY_LIMIT` 调整。正式发信域名应配置 SPF、DKIM 和 DMARC。

## 3. 配置 HTTPS 并首次部署

将 [Nginx 示例](../deploy/nginx.conf.example) 中的域名改为自己的域名，安装到服务器的 Nginx 配置目录并启用。运行 `nginx -t` 检查配置，再用已有的证书管理方式开启 HTTPS。若使用 Certbot，可参考：

```bash
certbot --nginx -d tud.example.com --email admin@example.com --agree-tos --no-eff-email --redirect
```

确认 `.env.production` 已配置后运行：

```bash
npm ci
npm run test:release
./scripts/deploy-production.sh
```

部署脚本依次构建新镜像、启动 PostgreSQL、执行向前迁移、替换应用容器、等待健康检查、预热图标目录。如果新应用未通过健康检查，会恢复上一成功镜像；数据库迁移不会自动回退。

检查状态、日志和健康接口：

```bash
docker compose --env-file .env.production -f compose.production.yaml ps
docker compose --env-file .env.production -f compose.production.yaml logs -f --tail=200 app postgres
curl --fail https://tud.example.com/api/health
```

## 4. 安装提醒任务

生产环境需要可用 SMTP、符合条件的管理者邮箱，以及每日提醒任务。每位成员的提醒还需在其收款安排中单独开启。任务检查**北京时间的次日**到期项目，并把同一订阅同日的续费与成员应收合成一封邮件发给管理者。

仓库的 [cron 模板](../deploy/tud-reminders.cron) 使用 `5 0 * * *`，即**服务器 cron 时区为 UTC 时**的北京时间每天 08:05。如果服务器使用其他时区，请先换算 cron 表达式。模板假定仓库在 `/opt/tud`；路径不同也要修改。

```bash
install -m 644 deploy/tud-reminders.cron /etc/cron.d/tud-reminders
```

日志写入 `/var/log/tud-reminders.log`。正常重复运行时发送记录会防止重发；若邮件服务已接收邮件、数据库却未记录成功，重试仍可能再发一次。

## 5. 备份数据库

随时可创建 PostgreSQL 自定义格式备份：

```bash
./scripts/backup-postgres.sh
```

备份默认写入服务器的 `backups/`，文件权限为 `600`。仓库的 [每日备份模板](../deploy/tud-backup.cron) 假定仓库在 `/opt/tud`，且服务器 cron 时区为 UTC；满足这两个条件时，每天 UTC 03:17 执行。

```bash
install -m 644 deploy/tud-backup.cron /etc/cron.d/tud-backup
```

请把备份另存到其他机器或对象存储，并定期在隔离环境验证恢复；与应用同盘的备份不能覆盖服务器故障风险。恢复前先停止应用。

## 6. 更新与回滚

确认已测试的代码推送到部署分支后，在**干净的服务器工作区**执行：

```bash
./scripts/update-production.sh
```

脚本只接受 fast-forward 更新，再复用首次部署流程。工作区有未跟踪、已修改或已暂存文件时会拒绝执行。

若新版应用异常，可恢复上一成功镜像：

```bash
./scripts/rollback-production.sh
```

回滚只更换应用镜像，**不会反向执行数据库迁移**。数据库结构变更应保持向后兼容；迁移本身出问题时，需要从备份恢复数据库。

## 7. 不使用 Docker

也可以自行提供 PostgreSQL、Node.js 进程管理、HTTPS 反向代理和备份。把 `.env.example` 中需要的生产变量注入运行环境后，在仓库目录执行：

```bash
npm ci
npm run db:migrate:runtime
npm run build
NODE_ENV=production npm start
```

这种部署方式还需要自行处理进程重启、日志轮转、健康检查和邮件提醒任务。

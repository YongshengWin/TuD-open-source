# 参与 TuD 开发

感谢你愿意帮助改进 TuD。请先搜索现有 Issue 和 Pull Request；较大的功能或架构调整，建议先开 Discussion 或 Issue 对齐目标，避免重复工作。

## 开发环境

需要 Node.js 22.13.0 或更高版本、npm，以及一个兼容的 PostgreSQL 数据库。本地可直接使用 Docker：

```bash
cp .env.example .env
chmod 600 .env
npm ci
docker compose up -d postgres
npm run db:migrate
npm run dev
```

请只在本地 `.env` 中填写真实配置。不要把密钥、生产域名、私人邮箱、数据库转储或真实用户数据写进提交、测试夹具、截图和日志。

## 提交改动

1. 从最新的 `main` 创建短期分支。
2. 保持改动聚焦；数据库结构变化必须包含 Drizzle migration。
3. 为修复和行为变化补充测试，并同步相关文档和示例环境变量。
4. 提交前运行 `npm run test:release`。
5. Pull Request 中说明问题、方案、验证方式、数据迁移与兼容性影响。界面改动请附桌面端和窄屏截图。

请勿在未经授权的情况下复制其他项目的源码、设计、文案或品牌素材。新增依赖和资产时，应确认许可证兼容性，并在需要时更新 `THIRD_PARTY_NOTICES.md`。

## 评审标准

维护者会重点检查正确性、权限边界、数据安全、迁移可恢复性、性能、响应式体验、可访问性、测试覆盖和长期维护成本。维护者可能要求拆分范围过大的 Pull Request。

提交贡献即表示你有权提供这些改动，并同意按仓库根目录 `LICENSE` 中的项目许可证发布它们。第三方素材仍受其各自许可与商标规则约束。

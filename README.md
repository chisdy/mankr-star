# Mankr Star

单实例「智能收藏与追踪」工具：把 GitHub Star、X/Twitter 链接与通用网页统一入库，用 AI 自动摘要 / 分类 / 打标，Cron 跟踪仓库健康与更新，并用 KB Chat 在收藏库上问答。

## 能力一览

| 能力 | 说明 |
|------|------|
| 收藏来源 | GitHub 仓库、X/Twitter、通用网页（`source_type`: `github` / `twitter` / `url`） |
| 组织 | 树形文件夹、标签、全文检索（FTS）、筛选与归档 |
| AI | 用户自备 DeepSeek Key；异步摘要 / 文件夹 / 标签；无 Key 时规则降级 |
| 同步 | Cron 每 6 小时拉取 GitHub 更新，写入 Feed 事件与健康状态 |
| 洞察 | 来源 / 语言 / 健康分布、AI 用量、Cloudflare Free 额度、同步问题 |
| KB Chat | 基于收藏库检索 + 可选 AnySearch 联网；SSE 流式回答 |
| 设置 | DeepSeek / AnySearch / Cloudflare Analytics / GitHub PAT、跟踪阈值与动态订阅、公开浏览、JSON / Markdown 导出 |
| PWA | 可安装到桌面/主屏；Service Worker 只缓存应用外壳与构建产物，`/api` 不走缓存 |
| 浏览器扩展 | `apps/extension`（MV3）：一键把当前标签页带到收藏弹窗，见 [扩展说明](apps/extension/README.md) |

单用户实例：首个访客注册后锁定；不支持多用户 / Google OAuth（有意不做）。

## 技术栈

- **前端**：Vite + React（`apps/web`）
- **后端**：Cloudflare Workers + D1 + Cron（同仓库 Worker）
- **共享**：`packages/shared`（schema / 常量）、`packages/db`（Drizzle）、`packages/ui`（shadcn）

## 本地开发

```bash
pnpm install
pnpm db:migrate:local
pnpm --filter web dev
```

常用脚本：

| 命令 | 作用 |
|------|------|
| `pnpm dev` | 启动开发 |
| `pnpm test` | 全量测试 |
| `pnpm test:worker` | Worker / API 测试 |
| `pnpm db:migrate:local` | 本地 D1 迁移 |
| `pnpm deploy` | 部署到 Cloudflare |

## 密钥与配置

在应用 **设置页** 配置（加密写入 D1，接口不回显明文）：

- **DeepSeek API Key**：AI 分类 / KB Chat（必配才有完整 AI）
- **GitHub PAT**：提高 GitHub API 限额、导入 Stars、跟踪更新
- **AnySearch Key**（可选）：KB 联网检索
- **Cloudflare Account ID + Analytics Token**（可选）：洞察页查看 Workers / D1 Free 账户级剩余额度（需 Account Analytics 只读权限）

额度仪表盘路径：**设置** 配置凭证后，打开 **洞察**（`/insights`）顶部的「Cloudflare Free 额度」卡片。

Worker 环境变量见 `apps/web/wrangler.jsonc`（`APP_NAME` 等）。本地开发用 Wrangler 绑定 D1。

## 文档

- [产品需求（PRD）](docs/PRD.md)
- [技术方案](docs/TECHNICAL_DESIGN.md)

## UI 组件

本仓库基于 shadcn/ui monorepo。在 `apps/web` 下添加组件：

```bash
pnpm dlx shadcn@latest add button -c apps/web
```

```tsx
import { Button } from "@workspace/ui/components/button"
```

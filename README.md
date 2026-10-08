# Mankr Star

单实例「智能收藏与追踪」工具：把 GitHub Star、X/Twitter 链接与通用网页统一入库，用 AI 自动摘要 / 分类 / 打标，Cron 跟踪仓库健康与更新，并用 KB Chat 在收藏库上问答。

## 能力一览

| 能力 | 说明 |
|------|------|
| 收藏来源 | GitHub 仓库、X/Twitter、通用网页（`source_type`: `github` / `twitter` / `url`） |
| 组织 | 树形文件夹、标签、全文检索（FTS）+ 可选语义混合检索、筛选与归档 |
| AI | 用户自备 DeepSeek Key；异步摘要 / 文件夹 / 标签；无 Key 时规则降级 |
| 同步 | Cron 每 6 小时拉取 GitHub 更新，写入 Feed 事件与健康状态 |
| 每日热点 | `/discover`：AI、前端、后端 / 基础设施、开发工具四个固定频道；GitHub 候选仓库、HN 热门与经过验证的 RSS 更新；支持来源平台筛选和手动收藏 |
| 洞察 | 来源 / 语言 / 健康分布、AI 用量、Cloudflare Free 额度、同步问题 |
| KB Chat | 基于收藏库检索 + 可选 AnySearch 联网；SSE 流式回答 |
| 设置 | DeepSeek / AnySearch / Cloudflare Analytics / GitHub PAT、**API Token（MCP）**、每日热点开关、跟踪阈值与动态订阅、公开浏览、JSON / Markdown 导出 |
| MCP | `POST /api/mcp`（Bearer Token）；工具：search / get / list folders·tags / save / update |
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

## 每日热点的启用与运维

登录后，在 **设置 → 每日热点** 打开或关闭功能。保存只更新配置，后续专用 Cron 按开关推进同步；开启后尚无已发布内容时，设置页显示等待首次同步，首版就绪后才出现导航。关闭会隐藏入口和热点读接口内容、停止后续同步，保留已发布榜单及原收藏。热点不调用付费 AI，也不需要新的数据 API Key；已有 GitHub PAT 可提高配额。API 免费不代表 Workers / D1 的计算和存储没有成本。

设置保存在实例的 D1 中，无需修改部署配置或新增迁移。尚未保存每日热点设置时，使用 `DISCOVERY_ENABLED` 环境变量作为初始值，默认关闭；明确保存的设置优先于环境变量，开启和关闭都能覆盖它。新账号注册不会预先写入这项设置。生产启用前仍须核对目标 D1 的迁移记录、来源和完整 Cron 的目标套餐资源证据；这些条件未满足时保持功能关闭。

原业务触发器 `*/10 * * * *` 保持不变，热点使用 `5-55/10 * * * *` 单独推进。每天北京时间 08:00 后创建当天任务，每轮推进有预算的分片，显示实际发布时间。生产初始化由热点 Cron 完成；`GET /api/discovery/channels` 的 `enabled` 与 `ready` 都为 true 后才显示导航，首次失败时查看 Worker 日志及发现读接口状态。网页刷新只读已发布数据，不能触发抓取。

本地预览建议登录后在 **设置 → 每日热点** 开启；保存的是本地 D1 配置。`apps/web/.dev.vars` 的 `DISCOVERY_ENABLED=true` 只作为未保存设置时的初始值，不会改动生产配置。`pnpm dev` 不会自动运行 Cron，设置开关也不会立即抓取；在北京时间 08:00 后用以下命令推进一个热点分片，后续按同一命令续跑。已有成功频道发布、channels API 返回 `ready=true` 后，刷新页面即可看到「每日热点」导航；首次采样没有昨日增长是正常状态。上游限流时按任务重试时间等待，不通过高频空调用耗尽分片轮次。

```bash
curl -G 'http://localhost:5173/cdn-cgi/local/scheduled' \
  --data-urlencode 'cron=5-55/10 * * * *' \
  --data-urlencode 'format=json'
curl 'http://localhost:5173/api/discovery/channels'
```

GitHub Stars 增长只比较昨日成功采样，间隔须为 20–36 小时；首日显示「新发现」，缺失增长与真实零增长分别处理。HN 保留原生分数及评论数；RSS 标为「最新更新」。来源失败时使用有效期内的旧来源，全部失败时保留旧榜单及失败状态。关闭开关可停用并隐藏入口，保留新增表及原收藏数据。

一次同步以六小时内完成为目标，提前为来源终止、四频道发布与清理预留轮次；延迟触发超过期限时记录失败并保旧，清理随后恢复。预算配置有可执行下限，不应通过减小候选池或停用来源来宣称原方案资源验收通过。

开发环境可用 Wrangler 的 scheduled 测试路径及固定时钟验证。当前 RSS 本地冷解析的 sampled JS 曾超过 Workers Free 的 10 ms CPU 限制，缩小 RSS 样本也未稳定解决；因此尚未通过免费套餐的生产启用验收。需在 staging 记录完整 Cron 的平台 CPU/outcome、出站请求、D1 语句和读写行数，未通过时保持关闭，并评估 Paid Workers。采样脚本为 `scripts/discovery-resource-smoke.mjs`，其本地 profiler 与 `elapsedMs` 均不能替代平台 CPU 指标。详细规则、预算、回退与验收见 [每日热点计划](docs/superpowers/plans/2026-10-08-daily-discovery-plan.md)。

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

# Mankr Star — 技术方案文档（TDD）

| 字段 | 内容 |
|------|------|
| 项目代号 | **Mankr Star** |
| 文档版本 | v1.5 |
| 对应 PRD | [PRD.md](./PRD.md) v1.6（数据库：D1；AI：DeepSeek 官方 API，见 §7.5） |
| 创建日期 | 2026-08-04 |
| 修订日期 | 2026-08-05 |
| 文档状态 | 初稿 |
| 部署目标 | Cloudflare Workers（Free 起步） |
| 包管理 | **pnpm**（强制） |

---

## 1. 目标与约束

### 1.1 目标

落地 PRD 能力：**邮箱/用户名 + 密码**注册与登录（单用户实例）、GitHub 收藏、**AI 分类/打标/摘要（DeepSeek 官方 API，必需）**、更新跟踪；前端采用指定 shadcn preset 的 Vite Monorepo。

### 1.2 硬性约束

| 约束 | 说明 |
|------|------|
| 免费起步 | Workers Free + **D1 Free** + Cron（无第三方数据库账号）；AI 费用由用户 DeepSeek 账户承担 |
| 计算与前端 | 必须部署在 Cloudflare Workers（含 Static Assets） |
| UI 脚手架 | **必须**使用下方命令，不得改用其它 template/preset |
| 登录 | **邮箱/用户名 + 密码**；MVP **单用户实例**——全站仅允许注册一个账号，后续注册请求一律拒绝 |
| AI | **必需**（分类/打标/摘要）；MVP **仅** DeepSeek 官方 API；**不接入** Workers AI Binding |
| 版本策略 | 依赖用最新稳定版；**TypeScript 锁定 7.x，React Router 锁定 8.x** |

### 1.3 UI 初始化命令（强制）

在仓库根目录（空目录或清理后）执行：

```bash
pnpm dlx shadcn@latest init --preset b5ckO8Yzo --template vite --monorepo --pointer
```

说明：

- `--preset b5ckO8Yzo`：设计系统预设（颜色、字体、圆角、图标等），**不要手动解码或替换**。
- `--template vite`：Vite + React 模板。
- `--monorepo`：生成 pnpm workspace（通常含 `apps/web`、`packages/ui` 等）。
- `--pointer`：按钮等交互使用 `cursor: pointer`。

后续新增组件：

```bash
pnpm dlx shadcn@latest add <component> -c apps/web
```

Monorepo 下从 `@workspace/ui/components/...` 引用（以脚手架实际生成的包名为准）。

---

## 2. 总体架构

```text
┌──────────────────────────────────────────────────────────────┐
│  Browser                                                      │
│  apps/web — Vite + React + React Router 8 + TanStack Query    │
│  UI: packages/ui（shadcn preset b5ckO8Yzo）                   │
│  Settings：配置 DeepSeek API Key / 模型偏好（不持有明文 Key）   │
└────────────────────────────┬─────────────────────────────────┘
                             │ same-origin /api/*
┌────────────────────────────▼─────────────────────────────────┐
│  Cloudflare Worker（@cloudflare/vite-plugin）                  │
│  Hono API：auth / bookmarks / folders / tags / feed / AI    │
│  Cron：sync-updates、ai-backfill                              │
│  Bindings：DB(D1)、KV（可选）、R2（可选）                      │
│  出站：GitHub REST、DeepSeek Chat Completions（服务端）        │
└──────────────┬───────────────────────────┬───────────────────┘
               │                           │
        ┌──────▼──────┐             ┌──────▼──────────────┐
        │  D1         │             │ DeepSeek API        │
        │  + Drizzle  │             │ api.deepseek.com    │
        │  加密 Key   │             │ classify/tag/summary│
        └─────────────┘             └─────────────────────┘
```

**部署单元**：一个 Worker = 静态前端（SPA）+ `/api/*` 后端；`run_worker_first = ["/api/*"]`，其余走 Assets。

**单用户模型**：整个实例对应唯一操作者；`users` 表最多一行，`sessions` 绑定该用户；业务表（`bookmarks`、`folders` 等）**不存 `user_id`**，天然单租户，无需多用户隔离谓词。

**AI 调用边界**：DeepSeek API Key **仅在 Worker 内解密并用于出站请求**；浏览器只提交/清除 Key，永不拿到完整明文。

---

## 3. 数据库：Cloudflare D1

### 3.1 结论

> **采用 Cloudflare D1（SQLite）**：Workers 原生 Binding；应用层用 **Drizzle ORM（`drizzle-orm/d1`）**。

1. 数据、计算、Cron 同属 Cloudflare；AI 出站调用 DeepSeek，Key 密文落 D1。
2. Free 约 **5 GB** 存储，读约 500 万行/天、写约 10 万行/天，收藏场景足够。
3. 单用户收藏（数百～数千条）非重型 OLTP，SQLite/D1 匹配。
4. Drizzle 对 D1 一等支持；迁移用 drizzle-kit + `wrangler d1 migrations`。

### 3.2 连接与迁移

| 组件 | 选型 | 说明 |
|------|------|------|
| 数据库 | **D1** | `wrangler d1 create mankr-star` |
| ORM | **Drizzle** + `drizzle-orm/d1` | 类型安全查询 |
| 迁移 | drizzle-kit 生成 + `wrangler d1 migrations apply` | 本地 Miniflare / remote 分别执行 |

```ts
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@mankr/db/schema";

export function createDb(env: { DB: D1Database }) {
  return drizzle(env.DB, { schema });
}
```

### 3.3 容量与查询注意

- 收藏 + 标签 + 90 天事件日志：远低于 5 GB。
- 列表必须 **分页 + 合理索引**，避免全表扫描吃满 rows read。
- MVP 搜索可用多字段 `LIKE`；量上来后再加 **FTS5** 虚拟表。
- `update_events` 滚动删除，控制写放大。

### 3.4 逻辑 Schema（SQLite / D1 方言）

核心表（Drizzle `sqlite-core`）：

**身份与会话（单用户）**

- `users`：`id text PK`（UUID），`username text UNIQUE NOT NULL`，`email text UNIQUE`（可选），`password_hash text NOT NULL`，`github_pat_encrypted`，`deepseek_api_key_encrypted`（可选 TEXT），`deepseek_model`（可选 TEXT，默认逻辑值 `deepseek-v4-flash`），`created_at`，`updated_at`
  - **约束**：应用层保证全表最多 **1 行**；`POST /api/auth/register` 在已有用户时返回 `409 Conflict`。
  - 无 `google_sub`、`avatar_url` 等 OAuth 字段。
  - DeepSeek Key：AES-GCM 密文入库；响应侧只暴露「是否已配置」+ `last4`，**永不回传完整 Key**。
- `sessions`：`id`，`user_id FK → users`，`token_hash`，`expires_at`，`revoked_at`

**业务数据（无 `user_id`——单用户实例下省略）**

- `folders`：`parent_id`（自引用，最多 5 层 depth 0～4）、`depth`、`path`（物化路径）；`slug` **同级兄弟唯一**（非全局唯一）
- `bookmarks`：`source_type` + `canonical_url` 唯一；`folder_id` FK；含 AI/同步字段（`summary_ai`、`ai_status` 等）
- `tags` / `bookmark_tags`
- `update_events`
- 可选 `ai_jobs`（异步回填队列）
- `ai_usage_logs`：DeepSeek 调用用量（kind / model / tokens / status）；`bookmark_id` ON DELETE SET NULL

> **设计说明**：因 MVP 为单用户实例，`bookmarks`、`folders`、`tags` 等**不存 `user_id`**，简化查询与索引。若未来扩展多用户，迁移时可为各表补 `user_id` 并回填为当前唯一用户 ID。`sessions` 仍保留 `user_id` 以维持会话模型一致性。

索引重点：`bookmarks(created_at)`、`bookmarks(folder_id)`、`bookmarks(ai_status)`、`bookmarks(track_updates, last_synced_at)`、`folders(parent_id)`、`folders(path)`、`folders(parent_id, slug)`（同级 slug 唯一）。

---

## 4. 技术栈清单（最新稳定版）

> 下列版本为文档撰写时 `npm view` 快照（2026-08-04）。**脚手架与安装一律用 `@latest`**，以安装当时 registry 为准；锁文件提交 pnpm-lock.yaml。

| 层级 | 技术 | 版本快照 | 职责 |
|------|------|----------|------|
| UI 脚手架 | shadcn/ui CLI | `@latest` | Vite monorepo + preset `b5ckO8Yzo` |
| 前端框架 | React | 19.x | UI |
| 构建 | Vite | 8.x | 开发/构建 |
| 样式 | Tailwind CSS | 4.x | 随 shadcn 初始化 |
| 组件 | shadcn/ui + Radix/Base（随 preset） | — | `packages/ui` |
| 路由 | React Router | **8.x** | SPA 路由 |
| 服务端状态 | TanStack Query | 5.x | API 缓存与变更 |
| 表单校验 | Zod | 4.x | 前后端共享 schema 可放 `packages/shared` |
| API | Hono | 4.x | Workers HTTP 框架 |
| 运行时插件 | `@cloudflare/vite-plugin` | 1.x | Vite ↔ workerd 一体开发部署 |
| CLI | wrangler | 4.x | 绑定、密钥、部署 |
| ORM | drizzle-orm + drizzle-kit | 0.45.x / kit latest | D1 schema 与迁移 |
| 密码哈希 | Web Crypto PBKDF2 或 `@noble/hashes` | — | 注册/登录时 `password_hash` 存库；**永不存明文** |
| 加密 | Web Crypto AES-GCM | — | GitHub PAT 与 DeepSeek API Key 加密存 D1 |
| 语言 | TypeScript | **7.x** | 全栈严格模式 |
| AI | **DeepSeek 官方 API**（OpenAI 兼容 Chat Completions） | — | `https://api.deepseek.com`；默认 `deepseek-v4-flash`，可选 `deepseek-v4-pro` |
| 定时 | Cron Triggers | — | 合并为 1～2 个 |

**明确不采用：**

- Next.js / TanStack Start 作为主前端（与强制 Vite template 冲突）
- Prisma（Workers + D1 路径更重；本项目选 Drizzle）
- **Cloudflare Workers AI Binding**（MVP 不接入；无 `env.AI`）
- Google OAuth / 第三方 OAuth 库（MVP 不做）

---

## 5. Monorepo 结构

以 shadcn `--monorepo` 生成为准，推荐在其之上扩展：

```text
mankr-star/
├── apps/
│   └── web/                 # Vite React SPA +（推荐）内嵌 Worker 入口
│       ├── src/
│       │   ├── app/         # 路由与页面
│       │   ├── features/    # bookmarks / auth / feed / settings …
│       │   └── worker/      # Hono app（若使用 CF Vite plugin 同仓）
│       ├── vite.config.ts
│       └── wrangler.jsonc
├── packages/
│   ├── ui/                  # shadcn 组件（preset 产出）
│   ├── db/                  # drizzle schema、client factory、migrations
│   ├── shared/              # zod schemas、类型、常量
│   └── typescript-config/   # 若脚手架已生成则复用
├── docs/
│   ├── PRD.md
│   └── TECHNICAL_DESIGN.md
├── pnpm-workspace.yaml
└── package.json
```

**初始化顺序：**

1. 执行强制 shadcn init 命令（生成 web + ui monorepo）。
2. 新增 `packages/db`、`packages/shared`。
3. 在 `apps/web` 接入 `@cloudflare/vite-plugin`、Hono、`/api/*` 路由与 SPA `not_found_handling`。
4. 配置 D1 binding、Secrets（`SESSION_SECRET`、`PAT_ENCRYPTION_KEY`，以及可选 `AI_KEY_ENCRYPTION_KEY`）。**不配置** Workers AI binding。

---

## 6. 前端方案

### 6.1 强制 UI 基线

- 设计令牌与组件风格完全由 preset `b5ckO8Yzo` 决定。
- 业务页面只组合 `packages/ui` 组件 + Tailwind 工具类；避免另起一套设计系统。
- 布局、密度、鉴权面与应用壳规范见 **[UI_DESIGN.md](./UI_DESIGN.md)**（taste-skill）。

### 6.2 路由与页面（对齐 PRD §8）

| 路由 | 说明 | 鉴权 |
|------|------|------|
| `/register` | 注册（用户名/邮箱 + 密码）；**仅当实例尚无用户时可用** | 访客 |
| `/login` | 登录（用户名/邮箱 + 密码） | 访客 |
| `/` | 收藏库列表（侧栏文件夹树筛选） | 登录 |
| `/folders` | 重定向至 `/`（兼容旧链接） | 登录 |
| `/feed` | 更新动态 | 登录 |
| `/insights` | 库洞察（规模 / 构成 / DeepSeek 用量） | 登录 |
| `/settings` | 账号、登出、GitHub PAT、**DeepSeek API Key / 模型**、导出 | 登录 |
| `/bookmarks/:id` | 详情（或抽屉） | 登录 |

- 未登录访问受保护路由 → 重定向 `/login`。
- 实例已有用户时访问 `/register` → 重定向 `/login` 或展示「实例已初始化」提示。

### 6.3 数据层

- TanStack Query：`useQuery` / `useMutation`；mutation 成功后 `invalidateQueries`。
- API client：`fetch('/api/...')` + `credentials: 'include'`（Session Cookie）。
- Zod：对关键响应做解析（开发期抓契约漂移）。

### 6.4 状态原则

- 服务端状态不进全局 Redux。
- 仅 UI 态（抽屉开关、筛选草稿）用 React state / URL search params（筛选可分享）。

### 6.5 设置页 AI 配置（UI 契约）

- 表单：DeepSeek API Key（password 输入）、模型选择（`deepseek-v4-flash` | `deepseek-v4-pro`）。
- 展示态：`configured: boolean` + `last4`（若已配置）；**不展示完整 Key**。
- 操作：保存 Key、清除 Key、测试连接（P1）、保存模型偏好。

---

## 7. 后端方案（Workers + Hono）

### 7.1 路由前缀

| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/auth/register` | 注册（单用户：已有账号则 `409`） |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 登出 |
| GET | `/api/me` | 当前用户（含 `deepseek_configured` / `deepseek_last4` / `deepseek_model`，无完整 Key） |
| CRUD | `/api/bookmarks` | 收藏 |
| CRUD | `/api/folders` | 文件夹；删除可带 `bookmarkAction`：`detach` / `delete` / `move` |
| * | `/api/tags` | 标签列表/合并（P2） |
| GET | `/api/feed` | 更新事件 |
| GET | `/api/insights` | 库洞察与 AI 用量聚合（`?range=7d\|30d\|all`） |
| POST | `/api/bookmarks/import/github` | Stars 导入 |
| PUT/PATCH | `/api/settings/deepseek` | 写入/更新 DeepSeek Key 与模型；清除 Key |
| POST | `/api/settings/deepseek/test` | 测试连接（P1） |
| POST | `/api/bookmarks/:id/ai/regenerate` | 重新生成单条 AI 结果（P1） |
| GET | `/api/export` | JSON 导出（顶层键：`bookmarks`、`folders`、`tags`） |

### 7.2 鉴权中间件

1. 读 Session Cookie → 查 `sessions`（未过期、未吊销）→ 注入 `userId`（恒为唯一用户）。
2. 受保护路由要求有效 Session；无 Session → `401`。
3. 业务 handler **无需** `WHERE user_id = ?`（单用户表无 `user_id`）；仍通过 Session 保证仅已登录者可访问。
4. **可选公开浏览**：`users.public_browsing_enabled`（默认关）。开启后，`GET /api/bookmarks`、`/folders`、`/tags`、`/feed` 等对未登录访客走 `requireAuthOrPublicRead`；响应中 `notes` 脱敏，搜索不匹配 notes；写接口与 settings/insights/me 仍 `requireAuth`，例外：`POST /api/bookmarks/:id/open`（外链打开计数）在公开浏览开启时对访客放行。访客读接口带轻量 IP 限流。`GET /api/auth/status` 返回 `{ initialized, public_browsing_enabled, authenticated }`（软探测 Session，不 401）供前端门禁，避免访客请求 `/api/me`。

### 7.3 密码认证

**注册 `POST /api/auth/register`**

- Body（zod）：`username`（或 `email` + `username`）、`password`（最小长度等规则见 `packages/shared`）。
- 先查 `users` 表行数：若已有记录 → **`409 Conflict`**（`"instance already initialized"`）。
- 密码经 PBKDF2（或等价 KDF）哈希后写入 `password_hash`；插入唯一 `users` 行。
- 成功后创建 Session，Set-Cookie，返回用户摘要（不含密码/hash）。

**登录 `POST /api/auth/login`**

- Body：`username`（或 email）+ `password`。
- 查 `users` → 校验 `password_hash`；失败统一 `401`（不泄露用户名是否存在）。
- 成功创建 Session 并 Set-Cookie。

**登出 `POST /api/auth/logout`**

- 吊销当前 Session（`revoked_at`）并清除 Cookie。

**当前用户 `GET /api/me`**

- 需 Session；返回 `id`、`username`、`email`、`deepseek_configured`、`deepseek_last4`（可选）、`deepseek_model`（无 `password_hash`、无 PAT/DeepSeek 明文）。

**Secrets**：`SESSION_SECRET`（签名/加密 Session token）、`PAT_ENCRYPTION_KEY`（GitHub PAT）；DeepSeek Key 加密可用同一 `PAT_ENCRYPTION_KEY`，或独立 `AI_KEY_ENCRYPTION_KEY`（Workers Secrets）。

**密码策略（建议）**：最小 8 字符；注册/登录接口按 IP 限流防暴力破解。

### 7.4 GitHub 集成

- 元数据：GitHub REST（仓库信息、releases）。
- 可选 PAT（加密存于唯一 `users` 行）；无 PAT 时走低配额与更慢 Cron。
- 规范化 URL → `owner/repo` → `canonical_url`。

### 7.5 AI 分类 / 打标 / 摘要（DeepSeek 官方 API）

> **决策：AI 为产品必需能力**（自动分类、打标签、一句话用途摘要）。MVP **仅**使用 DeepSeek 官方 API；**不配置** Workers AI Binding。

| 项 | 约定 |
|----|------|
| Provider | DeepSeek 官方 API only |
| Base URL | `https://api.deepseek.com`（OpenAI 兼容 Chat Completions） |
| 默认模型 | `deepseek-v4-flash` |
| 可选模型 | `deepseek-v4-pro`（用户在设置页切换，写入 `users.deepseek_model`） |
| API Key | 用户在 Settings 配置；**AES-GCM** 加密后写入 `users.deepseek_api_key_encrypted` |
| 加密密钥 | Workers Secret：`PAT_ENCRYPTION_KEY` **或** 专用 `AI_KEY_ENCRYPTION_KEY` |
| 调用位置 | **仅 Worker 服务端** `fetch`；Key 解密后用于 `Authorization: Bearer …`，不出浏览器 |
| 时机 | 收藏 **先入库**（`ai_status=pending`），再异步调用 DeepSeek；Cron `ai-backfill` 扫 pending |

**请求形态（示意）**

```http
POST https://api.deepseek.com/chat/completions
Authorization: Bearer <decrypted-user-key>
Content-Type: application/json

{
  "model": "deepseek-v4-flash",
  "messages": [
    { "role": "system", "content": "…" },
    { "role": "user", "content": "repo 元数据 + README 截断 …" }
  ],
  "response_format": { "type": "json_object" }
}
```

**输入**：repo 名、description、topics、language、README 截断、**现有文件夹目录 JSON**（`id` / `name` / `parent_id` / `path_label` / `description`）。  
**输出**（zod 校验严格 JSON）：`summary`（≤80 字）、`folder_id`（已有文件夹 uuid 或 null）、`new_folder`（`{ name, parent_id }` 或 null）、`tags[]`、`use_cases[]`、`confidence`。兼容旧字段 `folder_path`（服务端按名解析）。  
**文件夹策略**：优先复用目录中的 `folder_id`；无合适项时可 `new_folder` 自动创建（**自动创建深度上限 3 层**）；禁止把新形态硬塞进不贴切路径。按文件夹筛选时通过 `path` 前缀匹配子树（含子文件夹下收藏）。文件夹 `slug` 为英文 kebab-case（与中文名称解耦；AI 建夹走英文化管道 + 本地回退）。

**Key 存取规则**

1. `PUT/PATCH /api/settings/deepseek`：接收明文 Key → AES-GCM 加密 → 写 D1；可同时写 `deepseek_model`。
2. 任何 GET（含 `/api/me`、settings 读接口）**只返回** `{ configured: true|false, last4?: string, model: string }`，**永不返回完整 Key**。
3. 清除 Key：将 `deepseek_api_key_encrypted` 置空。

**降级（无 Key / 余额不足 / 调用失败）**

- 按 `language` + GitHub `topics` 做规则分类与标签启发。
- 标记 `ai_status=fallback` 或 `failed`；前端可提示「请配置 DeepSeek API Key」或「重新生成」。
- 实例级软配额（日 AI 次数）可选，防止误循环打爆用户账单；超额保持 `pending` 由 Cron 回补。

**注意**：Free HTTP **CPU ~10ms** 偏紧——DeepSeek 出站与批量同步放在 waitUntil / Cron / 分片；添加收藏路径保持「快写库 + 异步 AI」。

### 7.6 Cron

合并为尽量少的 Trigger（Free 账号约 5 个上限）：

1. `*/30 * * * *` 或每日数次：`sync-updates`（分片扫描 `track_updates`）。
2. 可选同 Worker 内第二 cron：`ai-backfill`（扫描 `ai_status=pending`，解密 Key 后调 DeepSeek）。

---

## 8. Cloudflare 绑定与配置

`wrangler.jsonc`（示意；**无** `ai` binding）：

```jsonc
{
  "name": "mankr-star",
  "compatibility_date": "2026-08-04",
  "main": "./src/worker/index.ts",
  "assets": {
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "mankr-star",
      "database_id": "<d1-id>",
      "migrations_dir": "../../packages/db/migrations"
    }
  ],
  "triggers": {
    "crons": ["0 */6 * * *"]
  }
}
```

Secrets（`wrangler secret put`）：

- `SESSION_SECRET`
- `PAT_ENCRYPTION_KEY`（GitHub PAT；也可复用于 DeepSeek Key 加密）
- 可选 `AI_KEY_ENCRYPTION_KEY`（专用 DeepSeek Key 加密；若未设则回退 `PAT_ENCRYPTION_KEY`）
- 可选全局 GitHub token（仅作公共元数据兜底，优先用户 PAT）

> MVP **不需要** Google OAuth 相关 Secret；**不需要** Workers AI / 全局 DeepSeek Key Secret（Key 由用户在设置页写入 D1）。`AUTH_KV` 可选（若不用 OAuth state 可省略 KV binding）。

---

## 9. 安全设计

| 项 | 方案 |
|----|------|
| 传输 | 全站 HTTPS |
| 密码 | PBKDF2（或等价 KDF）+ 随机 salt；仅存 `password_hash`；响应永不含密码/hash |
| Session | HttpOnly + Secure + SameSite=Lax；DB 可吊销 |
| CSRF | 写操作依赖 SameSite Cookie；可选 CSRF token（同源 SPA 通常足够） |
| 单用户注册 | `register` 在已有 `users` 行时拒绝；防止实例被二次占用 |
| PAT | AES-GCM 加密后存 D1；接口只接受写入/删除，永不回显明文 |
| DeepSeek Key | AES-GCM 加密后存 `deepseek_api_key_encrypted`；GET 仅 `configured` + `last4`；仅 Worker 解密后出站 |
| 限流 | 注册/登录、AI 设置写入、导入、重新生成接口按 IP 限流 |
| 依赖 | pnpm audit；D1 路径一般**不需要** `nodejs_compat`（除非引入必须 Node API 的库） |

---

## 10. 本地开发与部署

### 10.1 开发

```bash
# 1. UI monorepo（强制命令）
pnpm dlx shadcn@latest init --preset b5ckO8Yzo --template vite --monorepo --pointer

# 2. 安装与扩展包（在仓库就绪后）
pnpm add hono drizzle-orm zod @tanstack/react-query react-router@^8
pnpm add -D @cloudflare/vite-plugin wrangler drizzle-kit typescript@^7

# 3. 本地
pnpm --filter web dev    # Vite + workerd（CF plugin）
```

- D1：本地默认走 Miniflare；需要时用 `wrangler d1` 对 remote 执行 migrations。
- 本地设置 `SESSION_SECRET`、`PAT_ENCRYPTION_KEY`（及可选 `AI_KEY_ENCRYPTION_KEY`）于 `.dev.vars` 或 `wrangler secret put`；首次启动后通过 `/register` 创建唯一账号，再在设置页填入 DeepSeek Key。
- 勿把 `SESSION_SECRET`、`PAT_ENCRYPTION_KEY`、`AI_KEY_ENCRYPTION_KEY`、用户 DeepSeek Key 明文提交进 git。

### 10.2 部署

```bash
pnpm --filter web build
pnpm deploy   # 先 remote D1 migrate，再 wrangler deploy
```

Workers Builds（Git 自动部署）必配：

| 项 | 值 |
|----|-----|
| Root directory | 留空（仓库根，以便 pnpm workspace 安装） |
| Build command | `pnpm run build` |
| Deploy command | `pnpm run deploy` |
| Non-production deploy command | `pnpm run deploy:version`（若开启非生产分支构建） |

勿在 monorepo 根直接跑 `npx wrangler deploy`：根目录无 `wrangler.jsonc`，会报 workspace 检测错误。

`pnpm run deploy` / `deploy:version` 都会先执行 `wrangler d1 migrations apply DB --remote`，再上传 Worker。单独迁库：`pnpm db:migrate:remote`。

**API Token（关键）**：默认 Workers Builds token **不含 D1**。Settings → Build → API token 需包含账户权限 **D1 Edit**（以及已有的 Workers Scripts Edit），否则自动迁移会失败、部署中断。

---

## 11. 与免费额度相关的实现策略

| 资源 | 策略 |
|------|------|
| Workers 10 万请求/天 | 全站登录；静态资源走 Assets 缓存 |
| D1 读/写日限额 | 列表分页、索引、避免 N+1；Cron 分片 |
| D1 5 GB | events 滚动删除；禁止存整份巨型 README（改 R2 或截断） |
| DeepSeek API | 费用在用户 DeepSeek 账户；服务端异步调用 + 实例级日软配额 + 无 Key/失败时规则 fallback |
| Cron ≤5 | 合并调度 |
| GitHub API | 用户 PAT；ETag / `If-Modified-Since`；分片 |

---

## 12. 分期落地（工程视角）

| 阶段 | 工程交付 |
|------|----------|
| E0 | shadcn monorepo 初始化；CF Vite plugin；健康检查 `/api/health` |
| E1 | D1 + Drizzle schema/migrate；**密码注册/登录 + Session**（单用户 `409` 守卫） |
| E2 | Bookmarks CRUD + 文件夹标签 + 列表筛选搜索 UI |
| E3 | GitHub fetch + **DeepSeek 官方 API** 分类/打标/摘要；Settings 配 Key；规则降级 |
| E4 | Cron 更新跟踪 + Feed 页 |
| E5 | 导入/导出、设置页完善、配额与限流 |
| E6 | `source_type` 插件化（Twitter 等） |

---

## 13. 风险与缓解

| 风险 | 缓解 |
|------|------|
| Free CPU 10ms | 快路径入库；慢路径 waitUntil / Cron；控制单请求查询数 |
| D1 rows read/write 日限额 | 索引 + 分页；监控 dashboard |
| DeepSeek 未配置 / 余额不足 / 超时 | 规则降级（`ai_status=fallback|failed`）；设置页引导配 Key；异步重试 |
| DeepSeek Key 泄露面 | AES-GCM + Workers Secret；接口永不回显完整 Key；仅服务端出站 |
| shadcn monorepo 与 CF plugin 集成摩擦 | E0 先打通「静态 + /api/health」再堆业务 |
| Zod 4 / React 19 / TS 7 生态差异 | 锁定 lockfile；脚手架若带出旧 TS/Router，初始化后升到 **TS 7** 与 **React Router 8** |
| 单用户实例误部署为公共服务 | 文档与 `/register` 明确「仅首次初始化」；可选部署时环境变量关闭注册 UI |

---

## 14. 决策摘要

| 决策点 | 结论 |
|--------|------|
| UI | **必须** `pnpm dlx shadcn@latest init --preset b5ckO8Yzo --template vite --monorepo --pointer` |
| 数据库 | **Cloudflare D1 + Drizzle** |
| API | Hono on Workers |
| 前端 | Vite React SPA + **React Router 8** + TanStack Query |
| 部署 | `@cloudflare/vite-plugin` 同仓构建部署 |
| 鉴权 | **邮箱/用户名 + 密码** + DB Session；**单用户实例**（拒绝二次注册） |
| AI | **必需**；**DeepSeek 官方 API only**（`https://api.deepseek.com`）；默认 `deepseek-v4-flash`，可选 `deepseek-v4-pro`；用户 Key AES-GCM 存 D1；**无 Workers AI Binding** |
| 语言 | **TypeScript 7** |
| 包管理 | pnpm |

---

## 附录 A — 参考链接

- [shadcn Vite 安装](https://ui.shadcn.com/docs/installation/vite)
- [Cloudflare Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/)
- [D1](https://developers.cloudflare.com/d1/)
- [Drizzle + D1](https://orm.drizzle.team/docs/connect-cloudflare-d1)
- [DeepSeek API 文档](https://api-docs.deepseek.com/)
- [Hono](https://hono.dev/)

---

*实现开始前：执行强制 shadcn 命令 → 接入 CF Vite plugin → 创建 D1 并 migrate → 配置加密 Secrets → 再写业务（含 Settings 配 DeepSeek Key）。*

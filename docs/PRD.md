# Mankr Star — 项目需求文档（PRD）

| 字段 | 内容 |
|------|------|
| 项目代号 | **Mankr Star** |
| 文档版本 | v1.7 |
| 创建日期 | 2026-08-04 |
| 修订日期 | 2026-08-08 |
| 文档状态 | 与实现对照修订 |
| 产品定位 | 单实例「智能收藏与追踪」工具，优先解决 GitHub Star 难分类、难检索的问题 |
| 核心约束 | **基础设施免费**（Cloudflare Workers + D1 + Cron）；**单用户**邮箱/密码登录；AI 使用 **DeepSeek 官方 API**（用户自备 Key，设置页配置，加密存 D1） |
| 技术方案 | 详见 [TECHNICAL_DESIGN.md](./TECHNICAL_DESIGN.md) |

---

## 1. 背景与问题

### 1.1 现状痛点

GitHub 原生 Star 能力难以支撑长期知识管理：

1. **分类能力弱**：Lists 数量有上限，且粒度粗，无法表达「用途 + 技术栈 + 状态」等多维信息。
2. **检索困难**：Star 越多越难按「当时为什么收藏」找回；缺少标签、摘要、用途说明。
3. **无更新感知**：项目发版、停更、仓库迁移、README 大改时，用户无主动通知。
4. **跨平台断裂**：有价值的链接不只在 GitHub（后续还有 X/Twitter、博客、文档站等），需要统一收藏入口。

### 1.2 产品目标

做一个 **个人收藏中枢（Bookmark Hub）**：

- 粘贴链接即可收藏；
- 用 AI **自动理解用途、分类、打标签**；
- 支持 **按分类 / 标签 / 全文检索** 快速找回；
- 对 GitHub 仓库做 **更新跟踪**；
- 架构上预留多平台链接扩展能力。

### 1.3 非目标（本期不做）

- 不做面向公众的社交网络 / 公开广场（数据默认私有）。
- 不做替代 GitHub 本身的代码托管或 CI。
- 不做企业级计费、团队空间、角色权限（RBAC）。
- **不做多用户**：每个部署实例仅允许一个账号；不支持多人各自独立库（留待后续阶段）。
- **不做 Google OAuth / 其它第三方登录**（留待后续阶段）。
- 不提供手机号、GitHub OAuth、魔法链接等其它登录方式（本期仅邮箱/用户名 + 密码）。
- 不依赖付费第三方**数据库**；AI 调用走用户自备的 DeepSeek Key（费用由用户 DeepSeek 账户承担）。
- MVP **不接入** Cloudflare Workers AI（避免 Free Neurons 限额与模型可用性波动）。

---

## 2. 技术平台：Cloudflare + DeepSeek

> **已定：基础设施在 Cloudflare（Workers + D1 + Cron + 可选 KV/R2）；AI 使用 DeepSeek 官方 API（用户自备 Key）。**  
> 明细见 [TECHNICAL_DESIGN.md](./TECHNICAL_DESIGN.md)。

### 2.1 能力映射

| 能力 | 组件 | 为何需要 |
|------|------|----------|
| 计算 / API / 前端托管 | Workers + Static Assets | 同域全栈，密钥不进前端 |
| 关系型数据 | **D1** | 收藏、Session、加密后的 DeepSeek Key / GitHub PAT |
| 定时任务 | Cron Triggers | 轮询 GitHub 更新、批量 AI 补全 |
| AI 推理 | **DeepSeek 官方 API** | 自动摘要 / 分类 / 打标签 |
| 缓存 / 临时态 | KV（可选） | 热缓存、限流计数 |
| 对象存储 | R2（可选） | README 快照等 |
| 身份认证 | Worker 凭证登录 | 邮箱/用户名 + 密码；单用户 Session |

### 2.2 选型理由

1. **基础设施免费**：D1 + Workers + Cron 同账号。
2. **AI 要接**：自动分类/打标是产品核心；不用 AI 则退化为手填标签，价值大减。
3. **DeepSeek 优于 Workers AI（对本案）**：分类质量更好；费用由用户 DeepSeek 账户承担；避开 Workers AI Free Neurons 与模型变动。
4. **Key 用户自管**：设置页配置，AES-GCM 等加密写入 D1，接口不回显明文。
5. **更新追踪需要 Cron**：与 Worker 同栈。

### 2.3 额度与风险规避

| 资源 | 说明 | 产品侧规避 |
|------|------|------------|
| Workers / D1 / Cron | Cloudflare Free | 登录态、分页、索引、Cron 合并 |
| DeepSeek | 用户余额与限流 | 无 Key → 规则降级；失败重试；设置页「测试连接」 |
| GitHub API | rate limit | 可选 PAT；增量同步 |

---

## 3. 用户与使用场景

### 3.1 目标用户

- 重度 GitHub Star 用户、独立开发者、技术学习者。
- 需要把「看到的好项目」沉淀成可检索知识库，而不是无序列表。
- 自托管或单实例部署：首次访问者完成注册后即成为该实例唯一账号，拥有全部收藏库。

### 3.2 核心场景（User Stories）

1. **注册与登录**：实例尚无账号时，访客可注册（邮箱/用户名 + 密码）；已有账号后仅可登录；后续注册请求被拒绝。
2. **一键收藏**：粘贴 `https://github.com/owner/repo`，系统拉取元数据并 AI 生成分类、标签、一句话用途。
3. **按用途找**：按「状态管理 / UI 组件 / 部署工具」等文件夹浏览；或按标签过滤。
4. **搜索找回**：按仓库名、描述、AI 摘要、笔记全文搜索。
5. **更新提醒**：关注的仓库有新 Release / 默认分支推送 / star 数显著变化时，在「动态」页可见。
6. **手动精修**：用户可改文件夹、增删标签、写私有笔记；AI 结果可覆盖。
7. **多来源收藏**：粘贴 X/Twitter 或通用网页链接，同样进入收藏流（**已落地**）。

---

## 3.3 实现状态快照（2026-08-08）

下列能力在代码中 **已落地**（与下方历史 Phase 文案对照时以本表为准）：

| 能力 | 状态 |
|------|------|
| Phase 0 骨架、单用户注册/登录 | 已落地 |
| GitHub 收藏 CRUD、AI 分类、文件夹/标签、Cron 同步、Feed | 已落地 |
| X/Twitter + 通用 URL（含账号/加密密码字段） | 已落地 |
| 归档、健康阈值（hot/stale 天）、JSON 导出、公开浏览 | 已落地 |
| KB Chat、洞察页、设置（DeepSeek / PAT / AnySearch） | 已落地 |
| GitHub Stars 导入 API | ✅ 含设置页导入 UI 与续导 |
| 事件级订阅偏好、Markdown 导出、README 摘录缓存、renamed、PWA、浏览器扩展 | ✅ Wave 3 已落地 |

## 4. 产品范围与分期

> 分期描述保留产品意图；**已落地项**见 §3.3。未完成项仍按 Phase 推进。

### 4.1 Phase 0 — 骨架（MVP 前置）— ✅

- Cloudflare Workers + 静态前端可访问。
- D1 schema（Drizzle）落地（含 `users` / `sessions`）；本地 `wrangler` 开发可用。
- **注册 / 登录闭环**：单用户注册（仅当无用户时）→ Session Cookie → 登出（见 5.0、6.3）。

### 4.2 Phase 1 — GitHub 收藏 MVP — ✅（导入 UI 持续产品化）

- 添加 / 编辑 / 删除 GitHub 收藏（单实例单用户库）。
- 自动拉取：owner、repo、description、topics、language、stars、forks、license、homepage、默认分支、最近 push 时间。
- AI：用途摘要 + 推荐文件夹 + 推荐标签。
- 文件夹 CRUD；标签；列表筛选与搜索。
- Cron：定期检查已收藏仓库的更新，写入变更日志。
- 导入：从 GitHub Starred 列表批量导入（需用户自备 Token，与登录无关）。

### 4.3 Phase 2 — 体验增强 — 部分完成

- ✅ 健康阈值（hot / stale 天数）；⏳ 事件级订阅偏好（仅 Release / push / stars_delta 开关）。
- ⏳ README 摘要缓存（优先 D1 TEXT 截断）。
- ✅ 重复链接 canonical 去重；⏳ 仓库转移（renamed）处理加强。
- ✅ 导出 JSON；⏳ Markdown。
- ✅ 已归档；「稍后阅读」若需要则另定语义。
- ✅ 设置页：改密、DeepSeek Key、登出；⏳ 撤销 GitHub Token UI。

### 4.4 Phase 3 — 多平台链接 — ✅ 首批已落地

- ✅ 统一 `Bookmark` 模型 + `source_type` 解析（`github` / `twitter` / `url`）。
- ✅ **X/Twitter** 与 **通用 URL**（元数据 + 笔记 + 可选站点账号字段）。
- 预留：YouTube 等专项解析器。

### 4.5 Phase 4 — 可选增长（仍尽量免费）

- ⏳ 多设备同步体验优化、PWA。
- ✅ 登录/注册限流等基础保护；配额策略可继续加强。
- ⏳ 浏览器扩展「一键收藏」。

### 4.6 后续阶段（非 MVP）

- **Google OAuth** 与其它第三方登录。
- **多用户**：每实例多账号、数据按用户隔离。

---

## 5. 功能需求详述

### 5.0 账号与登录（Auth）

> **已定决策：单用户实例；邮箱/用户名 + 密码注册与登录；无 Google OAuth（留待后续阶段）。**

| 需求 ID | 描述 | 优先级 |
|---------|------|--------|
| AUTH-01 | **注册**：仅当 `users` 表尚无记录时允许；提供邮箱（或用户名）+ 密码表单；若已有用户则返回明确错误（如「本实例已初始化」） | P0 |
| AUTH-02 | **登录**：已注册用户使用邮箱/用户名 + 密码验证；密码错误返回通用提示，不泄露账号是否存在 | P0 |
| AUTH-03 | **登出**：清除 Cookie 并作废服务端 session | P0 |
| AUTH-04 | 登录成功后签发 **HttpOnly / Secure / SameSite** Session Cookie（推荐 DB session 表，便于吊销） | P0 |
| AUTH-05 | 密码 **永不明文存储**；使用 Workers 兼容方案哈希（Web Crypto **PBKDF2** 或 **scrypt** 等），仅存 `password_hash` + 算法/盐参数 | P0 |
| AUTH-06 | **修改密码**（设置页）：校验当前密码后更新哈希 | P0 |
| AUTH-07 | 所有业务 API 必须校验当前 session；单用户下读写均归属该唯一账号 | P0 |
| AUTH-08 | 未登录访问受保护路由：前端展示登录/注册页；API 返回 `401` | P0 |
| AUTH-09 | 注册/登录接口限流，防止暴力破解与刷量耗尽 Free 额度 | P1 |
| AUTH-10 | 不提供「注销账号并允许他人重新注册」的开放流程（单用户实例）；可提供「清空全部数据」入口（P1） | P1 |
| AUTH-11 | 密码强度最低要求（长度等）与前端校验 | P1 |

**注册流程（逻辑）：**

```text
访客打开注册页
  → 检查 users 表是否已有记录
  → 若已有：拒绝注册，引导至登录页
  → 若无：校验邮箱/用户名 + 密码
  → 哈希密码，写入 users（仅此一行）
  → 创建 session，Set-Cookie
  → 重定向至应用首页
```

**登录流程（逻辑）：**

```text
用户提交邮箱/用户名 + 密码
  → 查询唯一用户记录
  → 校验 password_hash
  → 创建 session，Set-Cookie
  → 重定向至应用首页
```

**与 GitHub Token 的关系：** 账号登录只解决「你是谁」；拉取私有 Star 列表 / 提高 API 限额仍由用户在设置中可选粘贴 **GitHub PAT**（加密或仅存服务端），二者独立，**PAT 不参与登录**。

**后续阶段（非 MVP）：** Google OAuth、多用户注册与数据隔离。

### 5.1 收藏（Bookmark）

| 需求 ID | 描述 | 优先级 |
|---------|------|--------|
| B-01 | 支持通过完整 GitHub URL 或 `owner/repo` 添加收藏 | P0 |
| B-02 | 添加时校验仓库存在；失败给出明确错误 | P0 |
| B-03 | 同一规范 URL 不可重复；提示已存在并跳转 | P0 |
| B-04 | 支持用户笔记（Markdown 纯文本即可） | P0 |
| B-05 | 支持手动覆盖 AI 文件夹与标签 | P0 |
| B-06 | 支持归档 / 取消归档；归档默认不出现在主列表 | P1 |
| B-07 | 支持删除（软删优先，便于误删恢复） | P1 |
| B-08 | 批量导入 GitHub Stars | P1 |
| B-09 | 导出全部收藏为 JSON | P2 |

### 5.2 文件夹（Folder）

| 需求 ID | 描述 | 优先级 |
|---------|------|--------|
| C-01 | 用户可创建文件夹树（相对 GitHub Lists 无「官方上限」产品承诺；受 D1 容量与产品配额约束）；**最多 5 层**（depth 0～4） | P0 |
| C-02 | 文件夹含名称、颜色/图标、排序、描述 | P0 |
| C-03 | 单条收藏 **仅归属一个文件夹**（`folder_id`）；不支持多文件夹关联 | P0 |
| C-04 | 系统预置若干推荐文件夹模板（可改可删） | P1 |
| C-05 | AI 推荐文件夹时 **优先复用** 已有路径；无合适路径时可自动创建（**自动创建深度上限 3 层**，超出截断） | P0 |

**预置文件夹建议（可配置）：**

`前端框架` / `UI 组件` / `状态管理` / `后端与 API` / `数据库` / `DevOps 与部署` / `AI / LLM` / `工具与 CLI` / `学习与教程` / `设计资源` / `其他`

### 5.3 标签（Tag）

| 需求 ID | 描述 | 优先级 |
|---------|------|--------|
| T-01 | 多对多标签；标签可自动创建 | P0 |
| T-02 | AI 建议 3～8 个标签；用户可改 | P0 |
| T-03 | 标签页展示使用次数；支持合并同义标签 | P2 |
| T-04 | 结合 GitHub `topics` + AI 标签去重 | P1 |

### 5.4 AI 理解（DeepSeek）

| 需求 ID | 描述 | 优先级 |
|---------|------|--------|
| A-01 | 输入：repo 名、description、topics、README 截断、language | P0 |
| A-02 | 输出结构化 JSON：`summary`（≤80 字）、`folder_id`（已有文件夹 uuid 或 null）、`new_folder`（`{name, parent_id}` 或 null）、`tags[]`、`use_cases[]`、`confidence`；优先复用 `folder_id`，无合适项时可新建（自动创建深度上限 3 层） | P0 |
| A-03 | 使用 **DeepSeek 官方 API**（OpenAI 兼容 `https://api.deepseek.com`）；默认模型 **`deepseek-v4-flash`**（设置可改为 `deepseek-v4-pro`） | P0 |
| A-04 | DeepSeek API Key 在 **设置页** 配置；**AES-GCM（或等价）加密**后写入 D1；GET 接口仅返回「是否已配置」与脱敏尾号，**永不回显完整 Key** | P0 |
| A-05 | 未配置 Key、余额不足或调用失败时：按 language + topics **规则降级**，标记 `ai_status=fallback` / `failed` | P0 |
| A-06 | 设置页提供「测试连接」；支持清除 Key；支持「重新生成」单条收藏的 AI 结果 | P1 |
| A-07 | AI 调用在 Worker 服务端发起（Key 不出浏览器）；添加收藏时先入库再异步分类 | P0 |

### 5.5 更新跟踪

| 需求 ID | 描述 | 优先级 |
|---------|------|--------|
| U-01 | 定时拉取：`pushed_at`、`updated_at`、`stargazers_count`、latest release tag | P0 |
| U-02 | 变更写入 `update_events`（类型：push / release / stars_delta / meta_change） | P0 |
| U-03 | 动态页按时间倒序展示 | P0 |
| U-04 | 用户可对单仓库开关跟踪 | P1 |
| U-05 | 扫描采用分片 + 游标，避免一次 Cron 超时 / 打满 GitHub rate limit | P0 |
| U-06 | 可选：连续 N 天无 push 标记「可能停更」 | P2 |

### 5.6 检索与浏览

| 需求 ID | 描述 | 优先级 |
|---------|------|--------|
| S-01 | 列表：时间 / star 数 / 名称排序 | P0 |
| S-02 | 筛选：文件夹、标签、语言、是否归档 | P0 |
| S-03 | 关键词搜索：name、description、summary、notes、tags | P0 |
| S-04 | MVP 可用 SQL `LIKE`；数据量增大后再评估 FTS5 / 外部搜索 | P1 |

### 5.7 多平台扩展（模型预留，Phase 3 实现）

| 需求 ID | 描述 | 优先级 |
|---------|------|--------|
| X-01 | `bookmarks.source_type`: `github` \| `twitter` \| `url` … | P0（模型）/ P3（实现） |
| X-02 | 解析器接口：`parse(url) -> NormalizedBookmark` | 架构 P0 |
| X-03 | X：保存帖子 URL、作者、文本摘要、媒体占位；分类/标签同样走 AI（已落地一期：status 链接 + 公开元数据） | P3（已实现） |
| X-04 | 通用 URL：Open Graph 元数据（注意 Workers 抓取限制与版权） | P3 |

---

## 6. 非功能需求

### 6.1 成本

- 默认运行在 **Cloudflare Workers Free**。
- 禁止默认集成付费 LLM / 付费托管 DB。
- 基础设施走 Cloudflare Free；AI 费用由用户 DeepSeek 账户承担。监控 Workers / D1 用量；无 DeepSeek Key 时不发起付费调用。
- 文档与实现中明确额度仪表盘查看路径，避免静默超限。

### 6.2 性能

- 收藏列表 P95 < 500 ms（边缘 + D1 索引前提下）。
- 添加收藏：元数据拉取 < 3 s；AI 可异步（先入库再回填）。

### 6.3 安全与隐私

- **登录方式**：邮箱/用户名 + 密码（哈希存储）；**无 Google OAuth（本期）**。
- 密码：Web Crypto PBKDF2 / scrypt 等 Workers 安全哈希；禁止明文或弱可逆编码。
- Session：HttpOnly + Secure + SameSite=Lax（或 Strict）；服务端可吊销。
- 会话签名密钥、GitHub Token（可选）仅存 Workers Secrets 或 D1 加密字段，永不下发前端。
- 所有写接口与读业务接口鉴权；默认无公开内容 API。可选 **公开浏览**（设置页开关，默认关）：开启后未登录访客可只读访问收藏/动态/文件夹/标签 GET；笔记字段脱敏且不可被搜索命中；一切写操作与设置/洞察仍需登录。
- 单用户实例：业务数据无多租户隔离；`bookmarks` 等表不存 `user_id`（见技术方案）。
- 收藏与笔记视为私密数据，不做分析上报；公开浏览开启时笔记仍不对访客可见。
- 支持清空数据：删除 bookmarks / folders / tags / sessions / tokens（用户行可保留或一并清除，按产品决策）。

### 6.4 可靠性

- GitHub / AI 调用失败可重试；展示 `sync_status`。
- Cron 幂等：同一仓库同一事件不重复插入；扫描分片执行。

### 6.5 可维护性

- TypeScript 7 全栈；Wrangler 配置即基础设施。
- Schema 迁移可版本化（Drizzle migrations）。

---

## 7. 推荐技术架构

### 7.1 逻辑架构

```text
┌─────────────────────────────────────────────────────────┐
│  Web UI（React / 静态资源，Workers Assets 托管）         │
│  未登录 → 登录/注册页；已登录 → 私人收藏库               │
└───────────────────────────┬─────────────────────────────┘
                            │ HTTPS + Session Cookie
┌───────────────────────────▼─────────────────────────────┐
│  Cloudflare Worker API                                   │
│  - /api/auth/register / login / logout                   │
│  - REST/JSON：bookmarks / folders / tags / feed         │
│  - Auth middleware（session → user_id）                  │
│  - GitHub client（可选 PAT）                             │
│  - AI classify service（DeepSeek API，用户 Key）          │
└───────┬─────────────────┬─────────────────┬─────────────┘
        │                 │                 │
   ┌────▼────┐       ┌────▼────┐       ┌────▼────┐
   │   D1    │       │   KV    │       │   R2    │
   │ 主数据  │       │ 限流/   │       │ 快照可选 │
   │ +session│       │ 缓存可选│       │         │
   └─────────┘       └─────────┘       └─────────┘
        ▲
        │ Cron Trigger：sync-updates / ai-backfill
```

### 7.2 数据模型（逻辑）

> **单用户实例**：`users` 表最多一行；业务表（bookmarks / folders / tags）**不存 `user_id`**，与技术方案一致。未来若做多用户再迁移补字段。

**users**（单用户，MVP 仅一条记录）

- `id`（内部 UUID）
- `email` 或 `username`（唯一，用于登录标识）
- `password_hash`（PBKDF2/scrypt 等，含算法与盐元数据）
- `deepseek_api_key_encrypted?`（设置页配置，加密存储）
- `deepseek_model?`（默认 `deepseek-v4-flash`，可选 `deepseek-v4-pro`）
- `github_pat_encrypted?`（可选，用户自备）
- `created_at`, `last_login_at`

**sessions**

- `id`, `user_id`, `token_hash`, `expires_at`, `created_at`, `revoked_at`

**bookmarks**

- `id`
- `source_type`（`github` / …）
- `canonical_url`, `external_id`（如 `owner/repo`）
- `title`, `description`, `language`, `stars`, `forks`
- `summary_ai`, `folder_id`, `notes`
- `ai_status`（`pending` / `done` / `fallback` / `failed`）
- `track_updates`（bool）
- `last_synced_at`, `pushed_at`, `latest_release_tag`
- `archived_at`, `deleted_at`, `created_at`, `updated_at`
- 唯一约束建议：`(source_type, canonical_url)`

**folders**

- `id`, `name`, `slug`（英文 kebab-case，同级唯一；名称可中文，二者解耦）、`parent_id`, `depth`（0～4）, `path`（物化路径，如 `/uuid1/uuid2/`）, `color`, `sort_order`, `description`
- `slug` 在 **同级兄弟** 下唯一（非全局唯一）；新建/AI 建夹时可由 DeepSeek 将名称英文化生成，失败则本地 ascii 回退

**tags** / **bookmark_tags**

- 标准多对多（单实例内全局）

**update_events**

- `id`, `bookmark_id`, `event_type`, `payload_json`, `detected_at`

**ai_jobs**（可选）

- 异步补全队列（也可用 bookmark.ai_status + Cron 扫描代替）

**ai_usage_logs**

- DeepSeek 真实 HTTP 调用用量：`kind`（classify / slug_translate / connection_test）、`model`、`status`、token 计数、可选 `bookmark_id`、`latency_ms`
- 供 `/insights` 聚合；清空业务数据时一并删除

### 7.3 关键流程（添加 GitHub 收藏）

```text
用户提交 URL
  → 规范化 URL / 解析 owner/repo
  → GitHub API 拉元数据
  → 写入 bookmarks（ai_status=pending）
  → 调用 DeepSeek API 生成 summary/folder_id|new_folder/tags
  → 匹配或创建文件夹/标签并回写
  → 返回详情（AI 若超时则前端轮询或刷新可见）
```

### 7.4 更新跟踪流程

```text
Cron 每日触发
  → 取出 track_updates=1 且到扫描窗口的一批 bookmarks
  → GitHub API 对比 pushed_at / release / stars
  → 有差异则写 update_events + 更新 bookmarks 快照字段
  → 更新 last_synced_at；遵守 rate limit 休眠/分片
```

---

## 8. 界面信息架构（MVP）

详细视觉与交互见 **[UI_DESIGN.md](./UI_DESIGN.md)**。摘要：

1. **登录 / 注册页**：分裂构图；品牌优先；实例无用户可注册，已有用户仅登录。
2. **应用壳**：左侧窄轨（收藏 / 动态 / 洞察 / 设置）+ 文件夹树面板 + 主区。
3. **收藏库**：紧凑列表行 + 工具条筛选搜索 +「添加」。
4. **洞察**：库规模 / 构成 / DeepSeek Token 用量（时间窗 7d / 30d / 全部）。
5. **详情**：桌面右侧抽屉优先。
6. **设置**：改密、DeepSeek Key、GitHub PAT、导出、主题。

交互原则：工具密度高于营销站；空 / 载 / 错三态齐全；未登录不可进业务页。

---

## 9. 成功指标

| 指标 | 目标（MVP） |
|------|-------------|
| 注册 / 登录成功率 | ≥ 99%（排除用户主动取消或输错密码） |
| 重复注册拒绝正确率 | 100%（已有用户时注册必失败并提示） |
| 完成添加并自动分类成功率 | ≥ 90%（含 fallback） |
| 从想到到找到某收藏的操作步数 | ≤ 3（搜索或筛选） |
| 日均超免费额度次数 | 正常用量下为 0；超限有降级与提示 |
| 批量导入 200 stars | 可在额度内分批完成 |
| 更新事件漏检率 | 可接受「日级延迟」，不要求分钟级 |

---

## 10. 风险与开放问题

| 风险 | 影响 | 缓解 |
|------|------|------|
| Workers Free CPU 10 ms 偏紧 | 复杂请求失败 | 添加收藏拆成「快写库 + 异步 AI」；重活放 Cron |
| DeepSeek 未配置 / 调用失败 | 无自动分类 | 规则降级；设置页引导配置 Key；可重试 |
| 密码哈希实现不当 | 凭据泄露 | 强制 PBKDF2/scrypt + 足够迭代；禁止自定义弱哈希 |
| 暴力破解登录 | 账号被攻破 | 登录限流；可选 CAPTCHA（P2） |
| GitHub API 限额 | 同步中断 | 可选 PAT；增量与分片；无 PAT 用低优先级配额 |
| Twitter/X API 收费 | Phase 3 受阻 | 先做「仅存链接 + 用户笔记 + 有限公开元数据抓取」 |
| 单用户实例误部署多副本 | 数据不一致 | 文档说明「每实例一账号」；不提供跨实例同步 |

**已确认决策：**

1. 鉴权：**邮箱/用户名 + 密码**；**无 Google OAuth（本期）**。
2. 用户模型：**单用户实例**——首次注册成功即锁定，后续注册拒绝；登录使用该唯一账号。
3. **AI：接入 DeepSeek 官方 API**；Key 设置页配置并加密存 D1；默认 `deepseek-v4-flash`；无 Key 规则降级。**不接 Workers AI（MVP）**。
4. GitHub PAT：可选，仅用于 API 能力增强，**不作为登录方式**。
5. 后续阶段：Google OAuth、多用户（非 MVP）。

**仍待确认（不阻塞实现）：**

1. Session 有效期默认多少天？（默认：**30 天**，可「保持登录」延长）
2. 注册标识优先 **邮箱** 还是 **用户名**，或二者皆必填？（默认：**邮箱必填**，用户名可选展示名）
3. 「清空数据」是否保留 users 行以便仅重置收藏？（默认：**保留账号行，仅删业务数据**）

---

## 11. 里程碑建议

| 里程碑 | 交付物 | 预估 |
|--------|--------|------|
| M1 | 文档评审通过 + 仓库初始化 + D1 schema（含 users/sessions） | 0.5～1 天 |
| M1.5 | 单用户注册 / 登录 / 登出 / Session 中间件 | 1～2 天 |
| M2 | 添加 GitHub 收藏 + 列表筛选 | 2～3 天 |
| M3 | DeepSeek 自动分类打标 + Key 设置加密存储 + 降级 | 1～2 天 |
| M4 | Cron 更新跟踪 + 动态页 | 1～2 天 |
| M5 | Stars 批量导入 + 导出 + 设置（改密、DeepSeek Key、PAT） | 1～2 天 |
| M6 | Phase 3 模型扩展点落地（Twitter 可后置） | 按需 |

---

## 12. 总结

**Mankr Star** 要解决的是：GitHub Star「存得下、理不清、找不到、跟不上」。

技术栈：**Cloudflare Workers + D1 + Cron（+ 可选 KV/R2）**；AI 为 **DeepSeek 官方 API**（用户自备 Key）。基础设施免费档起步。UI 强制 shadcn Vite Monorepo preset（见技术方案）。

账号体系：**单用户实例**——邮箱/用户名 + 密码注册与登录；首个访客注册后实例锁定，他人无法再注册。GitHub Token 仅作可选 API 增强，不参与登录。Google OAuth 与多用户留待后续阶段。

---

## 附录 A — 术语

| 术语 | 含义 |
|------|------|
| Bookmark | 一条收藏，不限于 GitHub |
| Folder | 用户或 AI 指定的文件夹；单条收藏仅归属一个文件夹 |
| Tag | 多维标签 |
| Update Event | 跟踪到的仓库/链接变更记录 |
| Fallback | AI 不可用时的规则分类结果 |
| 单用户实例 | 每个部署仅允许一个账号；users 表 MVP 仅一行 |
| Session | 登录态；Cookie + 服务端记录，可吊销 |
| deepseek_api_key_encrypted | DeepSeek API Key 密文；仅服务端解密用于调用 |

## 附录 B — 参考（以官网为准，实现前复核）

- Workers / D1 / KV Pricing：Cloudflare Docs  
- DeepSeek API：https://api-docs.deepseek.com/（`deepseek-v4-flash` / `deepseek-v4-pro`）  
- Web Crypto（PBKDF2 / AES-GCM）：MDN / Workers 运行时文档  
- GitHub REST API rate limits：GitHub Docs  
- UI：shadcn Vite monorepo preset（见技术方案强制命令）  

---

*本文档为产品与技术共同输入；实现阶段可再拆 API 契约与 UI 线框，不在本 PRD 展开。*

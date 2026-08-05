-- Local demo seed for Mankr Star (folders era)
-- Login: demo / password123

DELETE FROM bookmark_tags;
DELETE FROM update_events;
DELETE FROM ai_jobs;
DELETE FROM bookmarks;
DELETE FROM tags;
DELETE FROM folders;
DELETE FROM sessions;
DELETE FROM users;

-- User: demo / password123
INSERT INTO users (id, username, email, password_hash, created_at, updated_at) VALUES
('11111111-1111-1111-1111-111111111111', 'demo', 'demo@mankr.star',
 'pbkdf2$sha256$100000$eHosK1q5xZDWNfdpPFCdDA==$w9aWxT2uEArJUKetT7MtwQjJ07vuJ/Q67YnbNzaLUxk=',
 datetime('now'), datetime('now'));

-- Preset root folders (depth 0)
INSERT INTO folders (id, name, slug, color, sort_order, description, is_preset, parent_id, depth, path, created_at, updated_at) VALUES
('a1000000-0000-4000-8000-000000000001', '前端框架', 'frontend-framework', '#3B82F6', 10, 'React/Vue/Svelte 等应用框架与元框架', 1, NULL, 0, '/a1000000-0000-4000-8000-000000000001/', datetime('now'), datetime('now')),
('a1000000-0000-4000-8000-000000000002', 'UI 组件', 'ui-components', '#8B5CF6', 20, '可复用 UI 组件库、设计系统', 1, NULL, 0, '/a1000000-0000-4000-8000-000000000002/', datetime('now'), datetime('now')),
('a1000000-0000-4000-8000-000000000003', '状态管理', 'state-management', '#EC4899', 30, '客户端/服务端状态与缓存', 1, NULL, 0, '/a1000000-0000-4000-8000-000000000003/', datetime('now'), datetime('now')),
('a1000000-0000-4000-8000-000000000004', '后端与 API', 'backend-api', '#10B981', 40, '服务端框架与 API', 1, NULL, 0, '/a1000000-0000-4000-8000-000000000004/', datetime('now'), datetime('now')),
('a1000000-0000-4000-8000-000000000005', '数据库', 'database', '#F59E0B', 50, '数据库与 ORM', 1, NULL, 0, '/a1000000-0000-4000-8000-000000000005/', datetime('now'), datetime('now')),
('a1000000-0000-4000-8000-000000000006', 'DevOps 与部署', 'devops', '#EF4444', 60, 'CI/CD 与部署', 1, NULL, 0, '/a1000000-0000-4000-8000-000000000006/', datetime('now'), datetime('now')),
('a1000000-0000-4000-8000-000000000007', 'AI / LLM', 'ai-llm', '#06B6D4', 70, '大模型与 Agent', 1, NULL, 0, '/a1000000-0000-4000-8000-000000000007/', datetime('now'), datetime('now')),
('a1000000-0000-4000-8000-000000000008', '工具与 CLI', 'tools-cli', '#6366F1', 80, '开发者工具与 CLI', 1, NULL, 0, '/a1000000-0000-4000-8000-000000000008/', datetime('now'), datetime('now')),
('a1000000-0000-4000-8000-000000000009', '学习与教程', 'learning', '#84CC16', 90, '教程与 awesome 列表', 1, NULL, 0, '/a1000000-0000-4000-8000-000000000009/', datetime('now'), datetime('now')),
('a1000000-0000-4000-8000-00000000000a', '设计资源', 'design', '#F97316', 100, '图标字体与设计资源', 1, NULL, 0, '/a1000000-0000-4000-8000-00000000000a/', datetime('now'), datetime('now')),
('a1000000-0000-4000-8000-00000000000b', '其他', 'other', '#64748B', 110, '无法归入以上目录', 1, NULL, 0, '/a1000000-0000-4000-8000-00000000000b/', datetime('now'), datetime('now'));

-- Nested demo tree under AI / LLM (3–4 levels)
INSERT INTO folders (id, name, slug, color, sort_order, description, is_preset, parent_id, depth, path, created_at, updated_at) VALUES
('a2000000-0000-4000-8000-000000000001', 'Agent Skills', 'agent-skills', '#06B6D4', 10, 'Agent / Cursor Skill 集合', 0,
 'a1000000-0000-4000-8000-000000000007', 1,
 '/a1000000-0000-4000-8000-000000000007/a2000000-0000-4000-8000-000000000001/',
 datetime('now'), datetime('now')),
('a2000000-0000-4000-8000-000000000002', 'Claude', 'claude', '#06B6D4', 10, 'Anthropic 生态', 0,
 'a2000000-0000-4000-8000-000000000001', 2,
 '/a1000000-0000-4000-8000-000000000007/a2000000-0000-4000-8000-000000000001/a2000000-0000-4000-8000-000000000002/',
 datetime('now'), datetime('now')),
('a2000000-0000-4000-8000-000000000003', '官方示例', 'official-examples', '#06B6D4', 10, '官方 Skill 示例', 0,
 'a2000000-0000-4000-8000-000000000002', 3,
 '/a1000000-0000-4000-8000-000000000007/a2000000-0000-4000-8000-000000000001/a2000000-0000-4000-8000-000000000002/a2000000-0000-4000-8000-000000000003/',
 datetime('now'), datetime('now'));

-- Child under 前端框架
INSERT INTO folders (id, name, slug, color, sort_order, description, is_preset, parent_id, depth, path, created_at, updated_at) VALUES
('a2000000-0000-4000-8000-000000000010', 'React 生态', 'react-ecosystem', '#3B82F6', 10, 'React 相关库', 0,
 'a1000000-0000-4000-8000-000000000001', 1,
 '/a1000000-0000-4000-8000-000000000001/a2000000-0000-4000-8000-000000000010/',
 datetime('now'), datetime('now'));

-- Tags
INSERT INTO tags (id, name, slug, created_at) VALUES
('b1000000-0000-4000-8000-000000000001', 'react', 'react', datetime('now')),
('b1000000-0000-4000-8000-000000000002', 'typescript', 'typescript', datetime('now')),
('b1000000-0000-4000-8000-000000000003', 'ai', 'ai', datetime('now')),
('b1000000-0000-4000-8000-000000000004', 'agent', 'agent', datetime('now')),
('b1000000-0000-4000-8000-000000000005', 'ui', 'ui', datetime('now'));

-- Bookmarks (enough for FolderCard peek)
INSERT INTO bookmarks (
  id, source_type, canonical_url, external_id, title, description, language,
  stars, forks, topics_json, summary_ai, folder_id, ai_status, track_updates,
  pushed_at, last_synced_at, sync_status, health_status, github_archived, repo_size,
  created_at, updated_at
) VALUES
('c1000000-0000-4000-8000-000000000001', 'github', 'https://github.com/facebook/react', 'facebook/react',
 'facebook/react', 'The library for web and native user interfaces.', 'TypeScript',
 230000, 47000, '["react","frontend"]', '用于构建 Web 与原生界面的 UI 库',
 'a2000000-0000-4000-8000-000000000010', 'done', 1,
 datetime('now'), datetime('now'), 'ok', 'hot', 0, 120000,
 datetime('now'), datetime('now')),
('c1000000-0000-4000-8000-000000000002', 'github', 'https://github.com/vercel/next.js', 'vercel/next.js',
 'vercel/next.js', 'The React Framework.', 'TypeScript',
 130000, 28000, '["nextjs","react"]', 'React 全栈元框架',
 'a2000000-0000-4000-8000-000000000010', 'done', 1,
 datetime('now'), datetime('now'), 'ok', 'hot', 0, 98000,
 datetime('now'), datetime('now')),
('c1000000-0000-4000-8000-000000000003', 'github', 'https://github.com/shadcn-ui/ui', 'shadcn-ui/ui',
 'shadcn-ui/ui', 'Beautifully designed components.', 'TypeScript',
 90000, 6000, '["ui","components"]', '可复制粘贴的设计系统组件',
 'a1000000-0000-4000-8000-000000000002', 'done', 1,
 datetime('now'), datetime('now'), 'ok', 'hot', 0, 12000,
 datetime('now'), datetime('now')),
('c1000000-0000-4000-8000-000000000004', 'github', 'https://github.com/pmndrs/zustand', 'pmndrs/zustand',
 'pmndrs/zustand', 'Bear necessities for state management.', 'TypeScript',
 52000, 1600, '["state","react"]', '轻量 React 状态管理',
 'a1000000-0000-4000-8000-000000000003', 'done', 1,
 datetime('now'), datetime('now'), 'ok', 'hot', 0, 800,
 datetime('now'), datetime('now')),
('c1000000-0000-4000-8000-000000000005', 'github', 'https://github.com/anthropics/skills', 'anthropics/skills',
 'anthropics/skills', 'Anthropic Agent Skills.', 'TypeScript',
 12000, 800, '["agent-skills","ai"]', 'Anthropic Agent Skill 官方集合',
 'a2000000-0000-4000-8000-000000000003', 'done', 1,
 datetime('now'), datetime('now'), 'ok', 'hot', 0, 2400,
 datetime('now'), datetime('now')),
('c1000000-0000-4000-8000-000000000006', 'github', 'https://github.com/langchain-ai/langchainjs', 'langchain-ai/langchainjs',
 'langchain-ai/langchainjs', 'LangChain for JavaScript.', 'TypeScript',
 14000, 2400, '["llm","ai"]', 'JS 侧 LLM 编排框架',
 'a1000000-0000-4000-8000-000000000007', 'done', 1,
 datetime('now'), datetime('now'), 'ok', 'hot', 0, 45000,
 datetime('now'), datetime('now')),
('c1000000-0000-4000-8000-000000000007', 'github', 'https://github.com/drizzle-team/drizzle-orm', 'drizzle-team/drizzle-orm',
 'drizzle-team/drizzle-orm', 'TypeScript ORM.', 'TypeScript',
 28000, 900, '["orm","sql"]', 'TypeScript ORM',
 'a1000000-0000-4000-8000-000000000005', 'done', 1,
 datetime('now'), datetime('now'), 'ok', 'hot', 0, 18000,
 datetime('now'), datetime('now')),
('c1000000-0000-4000-8000-000000000008', 'github', 'https://github.com/honojs/hono', 'honojs/hono',
 'honojs/hono', 'Ultrafast web framework.', 'TypeScript',
 25000, 700, '["api","workers"]', '边缘友好的轻量 Web 框架',
 'a1000000-0000-4000-8000-000000000004', 'done', 1,
 datetime('now'), datetime('now'), 'ok', 'hot', 0, 6000,
 datetime('now'), datetime('now'));

INSERT INTO bookmark_tags (bookmark_id, tag_id) VALUES
('c1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001'),
('c1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002'),
('c1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001'),
('c1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000005'),
('c1000000-0000-4000-8000-000000000005', 'b1000000-0000-4000-8000-000000000003'),
('c1000000-0000-4000-8000-000000000005', 'b1000000-0000-4000-8000-000000000004'),
('c1000000-0000-4000-8000-000000000006', 'b1000000-0000-4000-8000-000000000003');

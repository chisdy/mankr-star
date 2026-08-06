import { z } from "zod"

export const UserSchema = z.object({
  id: z.string(),
  username: z.string(),
  email: z.string().nullable().optional(),
  deepseek_configured: z.boolean().default(false),
  deepseek_last4: z.string().nullable().optional(),
  deepseek_model: z.string().nullable().optional(),
  github_pat_configured: z.boolean().default(false),
  github_pat_last4: z.string().nullable().optional(),
  hot_within_days: z.number().optional(),
  stale_after_days: z.number().optional(),
  created_at: z.string().optional(),
  last_login_at: z.string().nullable().optional(),
})

export const FolderSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  color: z.string().nullable().optional(),
  sort_order: z.number().optional(),
  description: z.string().nullable().optional(),
  parent_id: z.string().nullable().optional(),
  depth: z.number(),
  path: z.string(),
  path_label: z.string().optional(),
  is_preset: z.boolean().optional(),
  count: z.number().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})

export const TagSchema = z.object({
  id: z.string(),
  name: z.string(),
  count: z.number().optional(),
})

export const BookmarkSchema = z.object({
  id: z.string(),
  source_type: z.string().default("github"),
  canonical_url: z.string(),
  external_id: z.string().nullable().optional(),
  title: z.string(),
  description: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  stars: z.number().optional(),
  forks: z.number().optional(),
  summary_ai: z.string().nullable().optional(),
  site_name: z.string().nullable().optional(),
  image_url: z.string().nullable().optional(),
  favicon_url: z.string().nullable().optional(),
  content_excerpt: z.string().nullable().optional(),
  platform_meta: z.record(z.string(), z.unknown()).optional(),
  folder_id: z.string().nullable().optional(),
  folder_name: z.string().nullable().optional(),
  folder: FolderSchema.nullable().optional(),
  tags: z.array(z.string()).default([]),
  notes: z.string().nullable().optional(),
  ai_status: z.enum(["pending", "done", "fallback", "failed"]).default("pending"),
  track_updates: z.boolean().default(true),
  last_synced_at: z.string().nullable().optional(),
  pushed_at: z.string().nullable().optional(),
  latest_release_tag: z.string().nullable().optional(),
  sync_status: z
    .enum(["never", "ok", "not_found", "forbidden", "error"])
    .optional(),
  last_sync_error: z.string().nullable().optional(),
  health_status: z
    .enum([
      "unavailable",
      "empty",
      "archived",
      "stale",
      "active",
      "hot",
      "unknown",
    ])
    .optional(),
  github_archived: z.boolean().optional(),
  repo_size: z.number().nullable().optional(),
  archived_at: z.string().nullable().optional(),
  deleted_at: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string().optional(),
})

export const UpdateEventSchema = z.object({
  id: z.string(),
  bookmark_id: z.string(),
  bookmark_title: z.string().optional(),
  bookmark_external_id: z.string().optional(),
  event_type: z.enum(["push", "release", "stars_delta", "meta_change"]),
  payload_json: z.string().optional(),
  detected_at: z.string(),
})

export const RegisterFormSchema = z.object({
  username: z.string().min(2, "用户名至少 2 个字符"),
  email: z.string().email("请输入有效的邮箱地址").or(z.literal("")).optional(),
  password: z.string().min(8, "密码至少 8 个字符"),
})

export const LoginFormSchema = z.object({
  username: z.string().min(1, "请输入用户名或邮箱"),
  password: z.string().min(1, "请输入密码"),
})

export const AddBookmarkSchema = z.object({
  url: z.string().min(1, "请输入 GitHub、X 帖子或网页链接"),
  folder_id: z.string().optional(),
  notes: z.string().optional(),
})

export const DeepSeekConfigSchema = z.object({
  api_key: z.string().optional(),
  model: z.enum(["deepseek-v4-flash", "deepseek-v4-pro"]).default("deepseek-v4-flash"),
})

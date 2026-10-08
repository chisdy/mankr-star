/** 每日发现的固定频道及客户端/Worker 共用响应契约。 */
import { z } from "zod"

export const DISCOVERY_CHANNEL_IDS = [
  "ai",
  "frontend",
  "backend",
  "tools",
] as const
export const discoveryChannelSchema = z.enum(DISCOVERY_CHANNEL_IDS)
export type DiscoveryChannelId = z.infer<typeof discoveryChannelSchema>
export const discoverySourceSchema = z.enum(["github", "hn", "rss"])
export type DiscoverySource = z.infer<typeof discoverySourceSchema>

const dateTime = z.string().datetime({ offset: true })
// Lone UTF-16 surrogates expand during JSON serialization and cannot be displayed faithfully.
const unicodeText = z
  .string()
  .refine((value) => !/[\ud800-\udfff]/u.test(value))
const safeUrl = z
  .string()
  .max(2048)
  .url()
  .refine((value) => !/[\ud800-\udfff]/u.test(value))
  .refine((value) => /^https?:\/\//i.test(value))
export const discoveryEvidenceSchema = z.object({
  source: discoverySourceSchema,
  sourceId: z.string().min(1).max(120),
  url: safeUrl,
  observedAt: dateTime,
  publishedAt: dateTime.nullable(),
  stars: z.number().int().nonnegative().optional(),
  growth: z.number().int().nullable().optional(),
  previousObservedAt: dateTime.nullable().optional(),
  score: z.number().int().nonnegative().optional(),
  comments: z.number().int().nonnegative().optional(),
  position: z.number().int().nonnegative().optional(),
})
export type DiscoveryEvidence = z.infer<typeof discoveryEvidenceSchema>

export const discoveryItemSchema = z.object({
  id: z.string().min(1),
  title: unicodeText.min(1).max(500),
  summary: unicodeText.max(2000).nullable(),
  url: safeUrl,
  sourceType: z.enum(["github", "url"]),
  rank: z.number().int().min(1).max(20),
  publishedAt: dateTime.nullable(),
  evidence: z.array(discoveryEvidenceSchema).min(1).max(8),
  // 访客响应省略该字段；已登录但未收藏时为 null。
  savedBookmarkId: z.string().nullable().optional(),
})
export type DiscoveryItem = z.infer<typeof discoveryItemSchema>

export const discoverySourceStatusSchema = z.object({
  source: discoverySourceSchema,
  sourceId: z.string(),
  state: z.enum(["fresh", "stale", "failed", "empty"]),
  lastSuccessAt: dateTime.nullable(),
  errorCode: z.string().nullable(),
})
export type DiscoverySourceStatus = z.infer<typeof discoverySourceStatusSchema>

export const discoveryChannelsResponseSchema = z.object({
  enabled: z.boolean(),
  ready: z.boolean(),
  channels: z
    .array(z.object({ id: discoveryChannelSchema }))
    .length(4)
    .refine(
      (channels) => new Set(channels.map((channel) => channel.id)).size === 4
    ),
})
export type DiscoveryChannelsResponse = z.infer<
  typeof discoveryChannelsResponseSchema
>

export const discoveryResponseSchema = z.object({
  enabled: z.boolean(),
  channel: discoveryChannelSchema,
  state: z.enum([
    "disabled",
    "initializing",
    "updating",
    "ready",
    "empty",
    "partial",
    "failed",
  ]),
  edition: z
    .object({
      id: z.string(),
      day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      revision: z.number().int().positive(),
      publishedAt: dateTime,
      ruleVersion: z.string(),
    })
    .nullable(),
  items: z.array(discoveryItemSchema).max(20),
  sources: z.array(discoverySourceStatusSchema).max(8),
  sync: z.object({
    state: z.enum(["idle", "pending", "running", "succeeded", "failed"]),
    startedAt: dateTime.nullable(),
    finishedAt: dateTime.nullable(),
    errorCode: z.string().nullable(),
  }),
})
export type DiscoveryResponse = z.infer<typeof discoveryResponseSchema>

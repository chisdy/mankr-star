import { z } from "zod"
import {
  DISCOVERY_CHANNEL_IDS,
  discoveryChannelSchema,
  discoverySourceSchema,
} from "@mankr/shared"
import { assertPublicHttpUrl } from "../url-ssrf"
import type { DiscoveryConfig } from "./types"

export const DISCOVERY_EXECUTION_VERSION = 1
/** Absolute safety ceilings; configuration can lower them but cannot raise them. */
export const DISCOVERY_HARD_LIMITS: Readonly<DiscoveryConfig["budgets"]> =
  Object.freeze({
    requestsPerRound: 25,
    requestsPerDay: 320,
    d1StatementsPerRound: 40,
    concurrentRequests: 3,
    githubSearchesPerRound: 4,
    githubSearchesPerDay: 16,
    githubDetailsPerDay: 80,
    hnCandidates: 40,
    rssEntries: 30,
    pieceSize: 10,
    maxItems: 20,
  })
const positive = z.number().int().min(1).max(1_000_000)
const regex = z
  .string()
  .min(1)
  .max(4096)
  .refine((pattern) => {
    try {
      new RegExp(pattern, "iu")
      return true
    } catch {
      return false
    }
  })
const host = z
  .string()
  .min(1)
  .max(253)
  .refine(
    (value) =>
      /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u.test(value) && !value.includes("..")
  )
export const discoveryBudgetsSchema = z
  .object({
    requestsPerRound: positive,
    requestsPerDay: positive,
    // Includes bootstrap, identity merge/publication and lease finalization.
    d1StatementsPerRound: positive.min(16),
    concurrentRequests: positive,
    githubSearchesPerRound: positive,
    githubSearchesPerDay: positive,
    githubDetailsPerDay: positive,
    hnCandidates: positive,
    rssEntries: positive,
    pieceSize: positive,
    maxItems: positive,
  })
  .strict()
const feed = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/u),
    url: z
      .string()
      .max(2048)
      .refine((value) => !/[\ud800-\udfff]/u.test(value))
      .url()
      .refine((value) => {
        try {
          const url = assertPublicHttpUrl(value)
          return (
            url.protocol === "https:" &&
            !url.port &&
            !url.username &&
            !url.password
          )
        } catch {
          return false
        }
      }),
    allowedHosts: z.array(host).min(1).max(8),
    channels: z.array(discoveryChannelSchema).min(1).max(4),
    newestFirstVerified: z.boolean(),
    verifiedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict()
  .refine(
    (value) =>
      value.allowedHosts.includes(new URL(value.url).hostname.toLowerCase()) &&
      (!value.newestFirstVerified || value.verifiedAt !== null) &&
      new Set(value.channels).size === value.channels.length
  )
export const discoveryConfigSchema = z
  .object({
    ruleVersion: z.string().min(1).max(120),
    schemaVersion: z.literal(DISCOVERY_EXECUTION_VERSION),
    channels: z
      .array(
        z
          .object({
            id: discoveryChannelSchema,
            topics: z
              .array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,49}$/u))
              .length(2),
            keywords: z.array(z.string().min(1).max(120)).min(1).max(100),
            domains: z.array(host).max(30),
          })
          .strict()
      )
      .length(4)
      .refine((channels) =>
        DISCOVERY_CHANNEL_IDS.every(
          (id) => channels.filter((channel) => channel.id === id).length === 1
        )
      ),
    feeds: z
      .array(feed)
      .max(4)
      .refine(
        (feeds) => new Set(feeds.map((feed) => feed.id)).size === feeds.length
      ),
    classification: z
      .object({ excludedTitlePattern: regex, rssTechnicalPattern: regex })
      .strict(),
    ranking: z
      .object({
        cycle: z.array(discoverySourceSchema).min(1).max(100),
        growthSlots: positive.max(20),
        newSlots: positive.max(20),
      })
      .strict(),
    github: z
      .object({
        minStars: z.number().int().min(0).max(1_000_000),
        activeDays: positive.max(3650),
        pageSize: positive,
        poolPerChannel: positive,
      })
      .strict(),
    budgets: discoveryBudgetsSchema,
  })
  .strict()
export type DiscoveryModuleBudget = {
  schemaVersion: 1
  ruleVersion: string
  budgets: DiscoveryConfig["budgets"]
}
const moduleSchema = z
  .object({
    schemaVersion: z.literal(1),
    ruleVersion: z.string().min(1).max(120),
    budgets: discoveryBudgetsSchema,
  })
  .strict()
export function validateDiscoveryConfig(
  value: unknown
): DiscoveryConfig | null {
  try {
    const parsed = discoveryConfigSchema.safeParse(value)
    return parsed.success &&
      new TextEncoder().encode(JSON.stringify(parsed.data)).byteLength <= 65536
      ? parsed.data
      : null
  } catch {
    return null
  }
}
export function parseDiscoveryConfig(json: string): DiscoveryConfig | null {
  try {
    return validateDiscoveryConfig(JSON.parse(json))
  } catch {
    return null
  }
}
export function boundedBudgets(
  budgets: DiscoveryConfig["budgets"]
): DiscoveryConfig["budgets"] {
  return Object.fromEntries(
    Object.entries(DISCOVERY_HARD_LIMITS).map(([key, cap]) => [
      key,
      Math.min(cap, budgets[key as keyof typeof budgets]),
    ])
  ) as DiscoveryConfig["budgets"]
}
export function moduleBudget(config: DiscoveryConfig): DiscoveryModuleBudget {
  return {
    schemaVersion: 1,
    ruleVersion: config.ruleVersion,
    budgets: boundedBudgets(config.budgets),
  }
}
export function parseModuleBudget(
  json: string,
  executionVersion: number
): DiscoveryModuleBudget | null {
  if (executionVersion !== DISCOVERY_EXECUTION_VERSION) return null
  try {
    const value = JSON.parse(json)
    // The only supported legacy budget shape used fixed ceilings. This is a
    // deterministic compatibility rule, never a fallback to current config.
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0
    )
      return {
        schemaVersion: 1,
        ruleVersion: "legacy-fixed-budget",
        budgets: { ...DISCOVERY_HARD_LIMITS },
      }
    const parsed = moduleSchema.safeParse(value)
    return parsed.success
      ? { ...parsed.data, budgets: boundedBudgets(parsed.data.budgets) }
      : null
  } catch {
    return null
  }
}
export function executionConfig(
  task: DiscoveryConfig,
  module: DiscoveryModuleBudget
): DiscoveryConfig {
  const budgets = boundedBudgets(task.budgets)
  for (const key of [
    "requestsPerRound",
    "requestsPerDay",
    "d1StatementsPerRound",
    "concurrentRequests",
    "githubSearchesPerRound",
    "githubSearchesPerDay",
    "githubDetailsPerDay",
  ] as const)
    budgets[key] = Math.min(budgets[key], module.budgets[key])
  return {
    ...task,
    github: {
      ...task.github,
      pageSize: Math.min(25, task.github.pageSize),
      poolPerChannel: Math.min(20, task.github.poolPerChannel),
    },
    budgets,
  }
}

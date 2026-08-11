import {
  DEFAULT_DEEPSEEK_MODEL,
  isCloudflareConfigured,
  type SettingsValueMap,
} from "@mankr/shared"
import { isEmbeddingConfigured } from "./embeddings"

type UserRow = {
  id: string
  username: string
  email: string | null
  createdAt: string
}

/**
 * 登录、注册与 /me 共用的用户序列化。
 * 只输出配置状态与后四位，密文永不出现在响应里。
 */
export function serializeUser(user: UserRow, s: SettingsValueMap) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    deepseek_configured: Boolean(s.ai.deepseekApiKeyEncrypted),
    deepseek_last4: s.ai.deepseekKeyLast4,
    deepseek_model: s.ai.deepseekModel || DEFAULT_DEEPSEEK_MODEL,
    embedding_configured: isEmbeddingConfigured(s.ai),
    embedding_base_url: s.ai.embeddingBaseUrl.trim() || null,
    embedding_model: s.ai.embeddingModel || null,
    embedding_last4: s.ai.embeddingKeyLast4,
    embedding_reuse_ai_key: Boolean(s.ai.embeddingReuseAiKey),
    anysearch_configured: Boolean(s.search.anysearchApiKeyEncrypted),
    anysearch_last4: s.search.anysearchKeyLast4,
    github_pat_configured: Boolean(s.github.patEncrypted),
    cloudflare_configured: isCloudflareConfigured(s.cloudflare),
    cloudflare_account_id: s.cloudflare.accountId.trim() || null,
    cloudflare_token_last4: s.cloudflare.apiTokenLast4,
    hot_within_days: s.tracking.hotWithinDays,
    stale_after_days: s.tracking.staleAfterDays,
    event_push: s.tracking.eventPush,
    event_release: s.tracking.eventRelease,
    event_stars_delta: s.tracking.eventStarsDelta,
    event_meta_change: s.tracking.eventMetaChange,
    public_browsing_enabled: s.browsing.publicBrowsingEnabled,
    bookmark_pagination_mode: s.bookmarks.paginationMode,
    bookmark_page_size: s.bookmarks.pageSize,
    created_at: user.createdAt,
  }
}

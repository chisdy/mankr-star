import type { KbChatSource } from "@mankr/shared"
import * as React from "react"
import { useTranslation } from "react-i18next"

import {
  Citation,
  type CitationItem,
} from "@workspace/ui/components/agents/citations"
import { toSafeExternalHref } from "@/lib/safe-url"

/** 正文里的收藏引用 [#n] 与网页引用 [Wn] */
const CITATION_PATTERN = /\[#(\d+)\]|\[W(\d+)\]/g

/**
 * 来源的稳定 id。web 来源没有数据库 id，用 url 派生而不是数组下标，
 * 因为多轮累积追加后下标会变、锚点会指错。
 */
function sourceKey(source: KbChatSource): string {
  return source.type === "bookmark" && source.id
    ? `bookmark-${source.id}`
    : `web-${source.url}`
}

function hostname(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return undefined
  }
}

/**
 * KbChatSource → CitationItem。后端虽已过滤外链协议，前端仍兜底一次：
 * CitationList 会把 url 直接渲染成 <a href>，过不了校验的只留标题。
 */
export function toCitationItems(
  sources: readonly KbChatSource[] | undefined
): CitationItem[] {
  if (!sources?.length) return []
  return sources.map((source) => {
    const href = toSafeExternalHref(source.url)
    return {
      id: sourceKey(source),
      title: source.title,
      domain: href ? hostname(href) : undefined,
      ...(href ? { url: href } : {}),
    }
  })
}

/** 按类型分组的引用序号 → sources 下标，用于把正文标记对回来源列表 */
function buildCitationIndex(sources: readonly KbChatSource[]) {
  const bookmarks: number[] = []
  const webs: number[] = []
  sources.forEach((source, index) => {
    if (source.type === "bookmark") bookmarks.push(index)
    else webs.push(index)
  })
  return { bookmarks, webs }
}

/**
 * 渲染回答正文，把引用标记替换成指向来源列表的锚点。
 * 后端 system prompt 约定输出纯文本 + [#n] / [Wn]，所以不需要 markdown 渲染器。
 */
export function KbAnswerText({
  text,
  sources,
  idPrefix,
  streaming = false,
}: {
  text: string
  sources?: readonly KbChatSource[]
  idPrefix: string
  streaming?: boolean
}) {
  const { t } = useTranslation("kb")
  const list = sources ?? []
  const index = React.useMemo(() => buildCitationIndex(list), [list])

  const nodes: React.ReactNode[] = []
  let cursor = 0

  for (const match of text.matchAll(CITATION_PATTERN)) {
    const at = match.index
    const [raw, bookmarkNo, webNo] = match
    const ordinal = Number(bookmarkNo ?? webNo)
    const target = bookmarkNo
      ? index.bookmarks[ordinal - 1]
      : index.webs[ordinal - 1]
    const source = target === undefined ? undefined : list[target]

    // 编号对不上来源时保留原文，避免把模型写出的标记吞掉
    if (!source || target === undefined) continue

    if (at > cursor) nodes.push(text.slice(cursor, at))
    nodes.push(
      <Citation
        key={`${raw}-${at}`}
        citationId={sourceKey(source)}
        index={target + 1}
        idPrefix={idPrefix}
        label={t("sources.citationAria", { index: target + 1 })}
      />
    )
    cursor = at + raw.length
  }

  if (cursor < text.length) nodes.push(text.slice(cursor))

  return (
    <p className="whitespace-pre-wrap">
      {nodes}
      {streaming ? (
        <span
          aria-hidden
          className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-foreground/60 align-middle"
        />
      ) : null}
    </p>
  )
}

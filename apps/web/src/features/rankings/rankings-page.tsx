import { useMutation, useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  ArrowSquareOutIcon,
  EyeIcon,
  GlobeIcon,
  ThumbsUpIcon,
  TrophyIcon,
  WarningCircleIcon,
  type Icon,
} from "@phosphor-icons/react"

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import { EmptyState } from "@/components/empty-state"
import { ExternalLink } from "@/components/external-link"
import { useBookmarkDetail } from "@/hooks/use-bookmark-detail"
import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import type { BookmarkRankingItem, BookmarkRankings } from "@/lib/types"

type RankingKind = keyof BookmarkRankings

interface BoardConfig {
  kind: RankingKind
  icon: Icon
  labelKey: string
  descKey: string
  accentColorClass: string
  pillActiveClass: string
}

const BOARDS: BoardConfig[] = [
  {
    kind: "views",
    icon: EyeIcon,
    labelKey: "ranking.boardViews",
    descKey: "ranking.boardViewsDesc",
    accentColorClass: "bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-1 ring-blue-500/20",
    pillActiveClass: "group-hover/row:bg-blue-500/10 group-hover/row:text-blue-600 dark:group-hover/row:text-blue-400 group-hover/row:ring-blue-500/20",
  },
  {
    kind: "opens",
    icon: ArrowSquareOutIcon,
    labelKey: "ranking.boardOpens",
    descKey: "ranking.boardOpensDesc",
    accentColorClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/20",
    pillActiveClass: "group-hover/row:bg-emerald-500/10 group-hover/row:text-emerald-600 dark:group-hover/row:text-emerald-400 group-hover/row:ring-emerald-500/20",
  },
  {
    kind: "likes",
    icon: ThumbsUpIcon,
    labelKey: "ranking.boardLikes",
    descKey: "ranking.boardLikesDesc",
    accentColorClass: "bg-rose-500/10 text-rose-600 dark:text-rose-400 ring-1 ring-rose-500/20",
    pillActiveClass: "group-hover/row:bg-rose-500/10 group-hover/row:text-rose-600 dark:group-hover/row:text-rose-400 group-hover/row:ring-rose-500/20",
  },
]

/** 骨架屏行数，与常规卡片高度保持一致 */
const SKELETON_ROWS = 6

/** 提取干净的 hostname 用于副文本展示 */
function getHostname(url: string): string {
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`)
    return parsed.hostname.replace(/^www\./, "")
  } catch {
    return ""
  }
}

/** 格式化指标数量 */
function formatCount(n: number): string {
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`
  }
  return String(n)
}

/** 排名徽章样式 */
function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <span
        className="flex size-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-amber-500/25 to-amber-500/10 font-mono text-xs font-bold text-amber-700 shadow-2xs ring-1 ring-amber-500/30 dark:text-amber-300"
        title="Rank 1"
      >
        1
      </span>
    )
  }

  if (rank === 2) {
    return (
      <span
        className="flex size-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-slate-400/25 to-slate-400/10 font-mono text-xs font-bold text-slate-700 shadow-2xs ring-1 ring-slate-400/30 dark:text-slate-200"
        title="Rank 2"
      >
        2
      </span>
    )
  }

  if (rank === 3) {
    return (
      <span
        className="flex size-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-orange-600/25 to-orange-600/10 font-mono text-xs font-bold text-orange-800 shadow-2xs ring-1 ring-orange-500/30 dark:text-orange-300"
        title="Rank 3"
      >
        3
      </span>
    )
  }

  return (
    <span className="flex size-6 shrink-0 items-center justify-center font-mono text-xs font-semibold text-muted-foreground/60">
      {rank}
    </span>
  )
}

/**
 * 热门排行页：查看 / 访问 / 点赞三个榜并排展示。
 * 三个榜由同一个接口一次返回，整页只发一次请求。
 */
export function RankingsPage() {
  const { t } = useTranslation("bookmarks")
  const { openDetail } = useBookmarkDetail()

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.bookmarks.rankings,
    queryFn: () => api.getBookmarkRankings(),
    staleTime: 30_000,
  })

  // 从访问榜点出去也是一次真实跳转，照常计数
  const recordOpen = useMutation({
    mutationFn: (id: string) => api.recordBookmarkOpen(id, "external"),
  })

  const renderBoard = (
    config: BoardConfig,
    items: BookmarkRankingItem[],
  ) => {
    const { kind, icon: BoardIcon, pillActiveClass } = config

    if (isLoading) {
      return (
        <ul className="space-y-1.5">
          {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
            <li
              key={i}
              className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-1.5"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <Skeleton className="size-6 shrink-0 rounded-md" />
                <Skeleton className="size-7 shrink-0 rounded-md" />
                <div className="min-w-0 space-y-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
              <Skeleton className="h-5.5 w-12 shrink-0 rounded-full" />
            </li>
          ))}
        </ul>
      )
    }

    if (isError) {
      return (
        <div className="flex flex-1 items-center justify-center py-4">
          <EmptyState
            icon={WarningCircleIcon}
            className="w-full flex-1 min-h-[200px]"
          >
            {t("ranking.loadError")}
          </EmptyState>
        </div>
      )
    }

    if (items.length === 0) {
      return (
        <div className="flex flex-1 items-center justify-center py-4">
          <EmptyState
            icon={BoardIcon}
            className="w-full flex-1 min-h-[200px]"
          >
            {t("ranking.empty")}
          </EmptyState>
        </div>
      )
    }

    return (
      <ul className="space-y-1">
        {items.map((item, idx) => {
          const rank = idx + 1
          const hostname = getHostname(item.canonical_url)

          return (
            <li
              key={item.id}
              className="group/row relative -mx-2 flex items-center justify-between gap-2.5 rounded-lg px-2 py-1.5 transition-all duration-150 hover:bg-muted/60 active:scale-[0.995]"
            >
              {/* 主可点击区域 */}
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <RankBadge rank={rank} />

                {/* 图标容器 */}
                <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/40 p-1 ring-1 ring-border/50">
                  {item.favicon_url ? (
                    <img
                      src={item.favicon_url}
                      alt=""
                      className="size-full rounded-xs object-contain"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <GlobeIcon className="size-3.5 text-muted-foreground/60" />
                  )}
                </div>

                {/* 标题与域名两行展示 */}
                <div className="min-w-0 flex-1">
                  {kind === "opens" ? (
                    <ExternalLink
                      href={item.canonical_url}
                      onClick={() => recordOpen.mutate(item.id)}
                      title={item.title}
                      className="block truncate text-sm font-medium text-foreground transition-colors hover:underline group-hover/row:text-primary"
                    >
                      {item.title}
                    </ExternalLink>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openDetail(item.id)}
                      title={item.title}
                      className="block w-full truncate text-left text-sm font-medium text-foreground transition-colors hover:underline group-hover/row:text-primary"
                    >
                      {item.title}
                    </button>
                  )}

                  {hostname ? (
                    <span className="block truncate font-mono text-xs text-muted-foreground/70">
                      {hostname}
                    </span>
                  ) : null}
                </div>
              </div>

              {/* 右侧数值指标胶囊与快捷操作 */}
              <div className="flex shrink-0 items-center">
                <span
                  className={cn(
                    "flex items-center gap-1 rounded-full bg-muted/70 px-2.5 py-0.5 font-mono text-xs font-medium text-muted-foreground ring-1 ring-border/40 transition-colors",
                    pillActiveClass,
                  )}
                  title={`${t(config.labelKey)}: ${item.count}`}
                >
                  <BoardIcon className="size-3.5 shrink-0" />
                  <span>{formatCount(item.count)}</span>
                </span>

                {/* 辅助快捷按钮：常态不占位，悬停时从右向左平滑滑入推出 */}
                {kind !== "opens" && (
                  <div className="flex w-0 translate-x-2 items-center overflow-hidden opacity-0 transition-all duration-200 ease-out group-hover/row:w-7 group-hover/row:translate-x-0 group-hover/row:opacity-100 group-hover/row:pl-1">
                    <ExternalLink
                      href={item.canonical_url}
                      onClick={(e) => {
                        e.stopPropagation()
                        recordOpen.mutate(item.id)
                      }}
                      title={t("ranking.openLink")}
                      aria-label={t("ranking.openLink")}
                      className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <ArrowSquareOutIcon className="size-3.5" />
                    </ExternalLink>
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl space-y-6 pb-12">
      {/* 头部标题区 */}
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
              <TrophyIcon className="size-4.5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {t("ranking.title")}
            </h1>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("ranking.description")}
          </p>
        </div>
      </div>

      {/* 榜单卡片网格：等高对齐 */}
      <div className="grid items-stretch gap-5 lg:grid-cols-3">
        {BOARDS.map((config) => {
          const { kind, icon: BoardIcon, labelKey, descKey, accentColorClass } = config
          const items = data?.[kind] ?? []

          return (
            <Card
              key={kind}
              size="sm"
              className="flex h-full min-w-0 flex-col border-border/70 bg-card/95 shadow-xs transition-shadow duration-200 hover:shadow-md dark:border-border/50"
            >
              <CardHeader className="border-b border-border/40 pb-3.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded-md",
                        accentColorClass,
                      )}
                    >
                      <BoardIcon className="size-3.5" />
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="truncate text-sm font-semibold text-foreground">
                        {t(labelKey)}
                      </CardTitle>
                      <p className="truncate text-xs text-muted-foreground/80">
                        {t(descKey)}
                      </p>
                    </div>
                  </div>

                  {items.length > 0 && (
                    <span className="shrink-0 rounded-md bg-muted/60 px-2 py-0.5 font-mono text-xs font-medium text-muted-foreground/70 ring-1 ring-border/40">
                      {t("ranking.top10")}
                    </span>
                  )}
                </div>
              </CardHeader>

              <CardContent className="flex flex-1 flex-col pt-3">
                {renderBoard(config, items)}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

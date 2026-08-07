import * as React from "react"
import { useTranslation } from "react-i18next"
import { ArrowsClockwiseIcon } from "@phosphor-icons/react"

import { useQuery } from "@tanstack/react-query"
import { Button } from "@workspace/ui/components/button"
import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import { buildKbSuggestionSlots, type KbSuggestionSlot } from "./kb-suggestions"

export function KbChatWelcome({
  onPick,
  libraryEmpty,
  webSearch,
}: {
  onPick: (question: string) => void
  libraryEmpty: boolean
  webSearch: boolean
}) {
  const { t } = useTranslation("kb")
  const [offset, setOffset] = React.useState(0)

  // 分类与标签是其他面板已缓存的数据，这里蹭现成的缓存，不额外加接口
  const { data: folders = [] } = useQuery({
    queryKey: queryKeys.folders.all,
    queryFn: () => api.getFolders(),
    enabled: !libraryEmpty,
    staleTime: 60_000,
  })
  const { data: tags = [] } = useQuery({
    queryKey: queryKeys.tags.all,
    queryFn: () => api.getTags(),
    enabled: !libraryEmpty,
    staleTime: 60_000,
  })

  const slots = React.useMemo(
    () => buildKbSuggestionSlots({ folders, tags, offset }),
    [folders, tags, offset]
  )
  const suggestions = slots.map((slot) => suggestionText(slot, t))

  // 库空且未联网时无从检索，先引导去添加收藏
  if (libraryEmpty && !webSearch) {
    return (
      <p className="px-1 pt-4 text-xs leading-relaxed text-muted-foreground">
        {t("welcome.libraryEmpty")}
      </p>
    )
  }

  // 还没有分类/标签可用（新库或全在未归类）时回落到通用示例
  const examples = suggestions.length > 0 ? suggestions : staticExamples(t)
  const canShuffle = suggestions.length > 0 && folders.length + tags.length > 3

  return (
    <div className="space-y-3 px-1 pt-4">
      <p className="text-xs leading-relaxed text-muted-foreground">
        {webSearch && libraryEmpty
          ? t("welcome.introWebOnly")
          : t("welcome.intro")}
      </p>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-medium text-muted-foreground">
            {t("welcome.tryLabel")}
          </p>
          {canShuffle ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="size-6 text-muted-foreground hover:text-foreground"
              onClick={() => setOffset((prev) => prev + 1)}
              aria-label={t("welcome.shuffle")}
              title={t("welcome.shuffle")}
            >
              <ArrowsClockwiseIcon className="size-3.5" />
            </Button>
          ) : null}
        </div>
        {examples.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => onPick(example)}
            className="block w-full rounded-md border border-border/60 bg-card/40 px-2.5 py-1.5 text-left text-xs text-foreground/80 transition-colors hover:border-primary/50 hover:bg-primary/5"
          >
            {example}
          </button>
        ))}
      </div>
    </div>
  )
}

type Translate = (key: string, options?: Record<string, unknown>) => string

function suggestionText(slot: KbSuggestionSlot, t: Translate): string {
  switch (slot.kind) {
    case "folderSummary":
      return t("welcome.suggest.folderSummary", { name: slot.name })
    case "folderBridge":
      return t("welcome.suggest.folderBridge", {
        name: slot.name,
        other: slot.other,
      })
    case "tagFind":
      return t("welcome.suggest.tagFind", { name: slot.name })
    case "tagCompare":
      return t("welcome.suggest.tagCompare", { name: slot.name })
    case "recent":
      return t("welcome.suggest.recent")
  }
}

function staticExamples(t: Translate): string[] {
  const examples = t("welcome.examples", {
    returnObjects: true,
  }) as unknown as string[]
  return Array.isArray(examples) ? examples : []
}

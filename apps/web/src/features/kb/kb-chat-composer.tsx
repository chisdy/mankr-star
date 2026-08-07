import { KB_CHAT_MODELS } from "@mankr/shared"
import * as React from "react"
import { useTranslation } from "react-i18next"
import { GlobeIcon } from "@phosphor-icons/react"

import { PromptInput } from "@workspace/ui/components/agents/prompt-input"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"

/** 比 KB_CHAT_MESSAGE_MAX_CHARS 更严的输入上限，沿用改造前的取值 */
const INPUT_MAX_CHARS = 2000

export function KbChatComposer({
  value,
  onValueChange,
  onSubmit,
  busy,
  onStop,
  model,
  onModelChange,
  webSearch,
  onWebSearchChange,
  anysearchConfigured,
  onGoSettings,
}: {
  value: string
  onValueChange: (value: string) => void
  onSubmit: (value: string) => void
  busy: boolean
  onStop: () => void
  model: string
  onModelChange: (model: string) => void
  webSearch: boolean
  onWebSearchChange: (next: boolean) => void
  anysearchConfigured: boolean
  onGoSettings: () => void
}) {
  const { t } = useTranslation("kb")
  const [webHint, setWebHint] = React.useState(false)

  const models = React.useMemo(
    () =>
      KB_CHAT_MODELS.map((entry) => ({
        value: entry.model,
        label: t(`composer.models.${entry.model}`, {
          defaultValue: entry.model,
        }),
      })),
    [t]
  )

  const toggleWebSearch = () => {
    if (!webSearch && !anysearchConfigured) {
      setWebHint(true)
      return
    }
    setWebHint(false)
    onWebSearchChange(!webSearch)
  }

  return (
    <div className="shrink-0 space-y-2 border-t border-border/50 px-3 py-2.5">
      {webHint ? (
        <p className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
          {t("composer.webSearchUnconfigured")}
          <button
            type="button"
            className="underline underline-offset-2 hover:text-foreground"
            onClick={onGoSettings}
          >
            {t("gate.goSettings")}
          </button>
        </p>
      ) : null}

      <PromptInput
        value={value}
        onValueChange={onValueChange}
        onSubmit={(next) => onSubmit(next)}
        loading={busy}
        onStop={onStop}
        models={models}
        model={model}
        onModelChange={onModelChange}
        minRows={2}
        maxRows={6}
        maxLength={INPUT_MAX_CHARS}
        placeholder={t("composer.placeholder")}
        aria-label={t("composer.placeholder")}
        labels={{
          send: t("actions.send"),
          stop: t("actions.stop"),
          modelPlaceholder: t("composer.modelPlaceholder"),
        }}
        trailingAction={
          <TooltipProvider delay={200}>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    role="switch"
                    aria-checked={webSearch}
                    aria-label={t("composer.webSearch")}
                    disabled={busy}
                    onClick={toggleWebSearch}
                    className={cn(
                      // 边框常驻透明，开关切换时不产生 1px 抖动
                      "inline-flex size-8 shrink-0 items-center justify-center rounded-xl border border-transparent transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
                      webSearch
                        ? "border-muted bg-muted text-emerald-600 dark:text-emerald-400"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {/* 只剩图标，靠填充与否区分开关状态，不单纯依赖颜色 */}
                    <GlobeIcon
                      className="size-4"
                      weight={webSearch ? "fill" : "regular"}
                    />
                  </button>
                }
              />
              <TooltipContent side="top">
                {webSearch
                  ? t("composer.webSearchDisable")
                  : t("composer.webSearchEnable")}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        }
      />
    </div>
  )
}

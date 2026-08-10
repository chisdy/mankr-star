import * as React from "react"
import {
  createSearchParams,
  useNavigate,
  useSearchParams,
  type NavigateOptions,
  type URLSearchParamsInit,
} from "react-router"

/**
 * 把查询串序列化成地址栏可读形式：中文等非 ASCII 保持原文，
 * `&` / `=` 等保留字符仍以百分号编码，避免拆坏参数结构。
 *
 * `URLSearchParams.toString()` 会一律 encode；`decodeURI` 只还原非保留字符。
 */
export function toReadableSearch(params: URLSearchParams): string {
  const qs = params.toString()
  return qs ? `?${decodeURI(qs)}` : ""
}

type SetURLSearchParams = (
  nextInit?:
    | URLSearchParamsInit
    | ((prev: URLSearchParams) => URLSearchParamsInit),
  navigateOpts?: NavigateOptions,
) => void

/**
 * 与 `useSearchParams` 相同，但写入地址栏时保留中文可读，而不是 `%E4%B8…`。
 */
export function useReadableSearchParams(): [URLSearchParams, SetURLSearchParams] {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const setSearchParams = React.useCallback<SetURLSearchParams>(
    (nextInit, navigateOpts) => {
      const next = createSearchParams(
        typeof nextInit === "function"
          ? nextInit(new URLSearchParams(searchParams))
          : nextInit,
      )
      // 默认 flushSync：筛选/搜索切换时同拍提交 URL，列表才能立刻进入 isPending 骨架
      navigate(toReadableSearch(next), { flushSync: true, ...navigateOpts })
    },
    [navigate, searchParams],
  )

  return [searchParams, setSearchParams]
}

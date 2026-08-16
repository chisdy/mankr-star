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
 * 没有参数时返回空串，方便 `pathname + search` 拼接。
 */
export function toReadableSearch(params: URLSearchParams): string {
  const qs = params.toString()
  return qs ? `?${decodeURI(qs)}` : ""
}

/**
 * 给 `navigate(to)` 用的查询目标。空查询必须写成 `"?"`：
 * React Router 会把 `navigate("")` 解析成 pathname `/`（收藏列表），
 * 详情弹窗关掉后就会把用户从 /feed、/rankings 等页面弹走。
 */
export function searchNavigateTo(params: URLSearchParams): string {
  return toReadableSearch(params) || "?"
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
      navigate(searchNavigateTo(next), { flushSync: true, ...navigateOpts })
    },
    [navigate, searchParams],
  )

  return [searchParams, setSearchParams]
}

/**
 * 主内容区滚动容器。虚拟列表与「滚动到底自动加载」的哨兵都必须绑定它，
 * 否则会错误地观察 window 或筛选面板自己的滚动区。
 */
export const APP_SCROLL_ROOT_ID = "app-scroll-root"

export function getAppScrollRoot(): HTMLElement | null {
  if (typeof document === "undefined") return null
  return document.getElementById(APP_SCROLL_ROOT_ID)
}

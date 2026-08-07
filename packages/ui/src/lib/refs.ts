import type { Ref } from "react"

/**
 * 把节点写进调用方传来的 ref，函数式与对象式都支持。
 * 只应在挂载回调里调用，不要在 render 期间读写 ref。
 */
export function assignRef<T>(ref: Ref<T> | undefined, node: T | null): void {
  if (typeof ref === "function") ref(node)
  else if (ref) (ref as { current: T | null }).current = node
}

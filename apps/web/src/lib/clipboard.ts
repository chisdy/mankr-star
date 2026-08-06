import { toast } from "sonner"

/**
 * 复制文本到剪贴板。
 * 非安全上下文（非 HTTPS / 非 localhost）时只提示，绝不降级为展示明文。
 */
export async function copyText(
  text: string,
  options?: {
    successMessage?: string
    unsupportedMessage?: string
    /** 成功时不弹 toast（由调用方用图标反馈） */
    silent?: boolean
  },
): Promise<boolean> {
  const successMessage = options?.successMessage ?? "已复制"
  const unsupportedMessage =
    options?.unsupportedMessage ?? "当前环境不支持复制，请通过 HTTPS 访问"

  if (!text) return false

  if (
    typeof navigator === "undefined" ||
    !navigator.clipboard ||
    typeof navigator.clipboard.writeText !== "function"
  ) {
    toast.error(unsupportedMessage)
    return false
  }

  try {
    await navigator.clipboard.writeText(text)
    if (!options?.silent) toast.success(successMessage)
    return true
  } catch {
    toast.error(unsupportedMessage)
    return false
  }
}

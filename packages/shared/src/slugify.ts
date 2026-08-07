/** 将任意字符串转为 URL-safe slug（标签等可用，允许中文） */
export function slugify(input: string): string {
  return (
    input
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, "-")
      .replace(/[^a-z0-9\u4e00-\u9fff-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64) || "tag"
  )
}

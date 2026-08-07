import { Navigate, useParams } from "react-router"

import { bookmarkDetailHref } from "./bookmark-detail-params"

/**
 * 详情现在是叠在列表上的弹窗，`/bookmarks/:id` 只保留为旧链接的入口。
 */
export function BookmarkDetailPage() {
  const { id } = useParams<{ id: string }>()

  return <Navigate to={id ? bookmarkDetailHref(id) : "/"} replace />
}

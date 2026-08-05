import { useParams, useNavigate } from "react-router"
import { BookmarkDetailDrawer } from "./bookmark-detail-drawer"

export function BookmarkDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  return (
    <BookmarkDetailDrawer
      bookmarkId={id || null}
      open={true}
      onOpenChange={(open) => {
        if (!open) {
          navigate("/")
        }
      }}
    />
  )
}

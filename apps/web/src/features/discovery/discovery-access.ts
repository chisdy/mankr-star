/** 不能仅凭缓存的 /me 判定身份：status 确认会话后才允许私人响应。 */
export function resolveDiscoveryAccess(auth: {
  isLoading: boolean
  isAuthenticated: boolean
  user: { id: string } | null
  status: { authenticated: boolean } | null
  statusQuery: { isError: boolean }
  meQuery: { isError: boolean }
  publicBrowsingEnabled: boolean
}) {
  const confirmedAuthenticated = Boolean(
    auth.isAuthenticated &&
    auth.status?.authenticated &&
    auth.user &&
    !auth.meQuery.isError
  )
  const resolved =
    !auth.isLoading &&
    Boolean(auth.status) &&
    !auth.statusQuery.isError &&
    !(
      auth.status?.authenticated &&
      (!auth.isAuthenticated || auth.meQuery.isError)
    )
  return {
    canRead: resolved && (confirmedAuthenticated || auth.publicBrowsingEnabled),
    accessScope: confirmedAuthenticated && auth.user ? auth.user.id : "guest",
    publicReadEnabled: auth.publicBrowsingEnabled,
  }
}

/** 登录用户可在首次发布前查看准备状态；公开访客仍等待可读榜单。 */
export function isDiscoveryNavigationVisible(
  auth: Parameters<typeof resolveDiscoveryAccess>[0],
  discovery: { enabled: boolean; ready: boolean } | undefined
): boolean {
  const access = resolveDiscoveryAccess(auth)
  const confirmedOwner = Boolean(
    auth.isAuthenticated && auth.status?.authenticated && auth.user
  )
  return (
    access.canRead &&
    Boolean(discovery?.enabled && (discovery.ready || confirmedOwner))
  )
}

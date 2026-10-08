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
